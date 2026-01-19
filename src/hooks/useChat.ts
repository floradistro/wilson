import { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import type { Message, ToolCall, ToolData, Todo, PendingQuestion, PendingPermission } from '../types.js';
import { useStream, type StreamEvent } from './useStream.js';
import { useTools } from './useTools.js';
import { sendChatRequest } from '../services/api.js';
import { compactConversation } from '../utils/context.js';
import { truncateAssistantContent } from '../utils/context-manager.js';
import { log } from '../utils/logger.js';

// Throttle function for streaming updates
function createThrottle<T extends (...args: any[]) => void>(fn: T, ms: number): T {
  let lastCall = 0;
  let timeout: ReturnType<typeof setTimeout> | null = null;
  let lastArgs: Parameters<T> | null = null;

  return ((...args: Parameters<T>) => {
    const now = Date.now();
    lastArgs = args;

    if (now - lastCall >= ms) {
      lastCall = now;
      fn(...args);
    } else if (!timeout) {
      timeout = setTimeout(() => {
        timeout = null;
        lastCall = Date.now();
        if (lastArgs) fn(...lastArgs);
      }, ms - (now - lastCall));
    }
  }) as T;
}

interface ToolCallbacks {
  onAskUser?: (question: PendingQuestion) => Promise<string>;
  onPermissionRequest?: (permission: PendingPermission) => Promise<boolean>;
  skipPermissions?: boolean;
}

interface UsageStats {
  inputTokens: number;
  outputTokens: number;
}

export function useChat() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [todos, setTodos] = useState<Todo[]>([]);
  const [usage, setUsage] = useState<UsageStats>({ inputTokens: 0, outputTokens: 0 });
  const [toolCallCount, setToolCallCount] = useState(0);
  const [contextTokens, setContextTokens] = useState(0);
  const [streamingChars, setStreamingChars] = useState(0);

  const conversationIdRef = useRef(crypto.randomUUID());
  const abortControllerRef = useRef<AbortController | null>(null);
  const { executeTools } = useTools();
  const { processStream } = useStream();

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
    };
  }, []);

  const sendMessage = useCallback(async (
    content: string,
    accessToken: string,
    storeId: string,
    callbacks?: ToolCallbacks
  ) => {
    // Abort any existing request
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    abortControllerRef.current = new AbortController();

    setError(null);
    setIsStreaming(true);
    setStreamingChars(0);

    // Add user message
    const userMessage: Message = {
      id: crypto.randomUUID(),
      role: 'user',
      content,
      timestamp: new Date(),
    };

    // Add empty assistant message (streaming)
    const assistantMessage: Message = {
      id: crypto.randomUUID(),
      role: 'assistant',
      content: '',
      toolCalls: [],
      timestamp: new Date(),
      isStreaming: true,
    };

    setMessages(prev => [...prev, userMessage, assistantMessage]);

    // Build initial conversation history from previous messages (for multi-turn)
    // Include the user's new message to start the conversation
    const initialHistory: Array<{ role: string; content: unknown }> = messages.slice(-20).map(m => ({
      role: m.role,
      content: m.content,
    }));
    // Add the new user message
    initialHistory.push({ role: 'user', content });

    try {
      await runAgentLoop({
        userMessage: content,
        conversationHistory: initialHistory,
        accessToken,
        storeId,
        callbacks,
        accumulatedContent: '',
        accumulatedTools: [],
        depth: 0,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to send message');
    } finally {
      setIsStreaming(false);
    }
  }, [messages]);

  // Main agent loop - handles streaming and tool execution
  async function runAgentLoop(params: {
    userMessage: string;
    // Full conversation history - accumulates across tool calls
    conversationHistory: Array<{ role: string; content: unknown }>;
    accessToken: string;
    storeId: string;
    callbacks?: ToolCallbacks;
    accumulatedContent: string;
    accumulatedTools: ToolCall[];
    depth: number;
    // Loop tracking from backend (passed back on continuation)
    toolCallCount?: number;
    loopDepth?: number;
    // Session-level tool history for loop detection (persists across iterations)
    sessionToolHistory?: string[];
  }) {
    const {
      userMessage,
      conversationHistory,
      accessToken,
      storeId,
      callbacks,
      accumulatedContent,
      accumulatedTools,
      depth,
      toolCallCount,
      loopDepth,
      sessionToolHistory = [],
    } = params;

    // LOOP DETECTION: Use session-level tool history (persists across iterations)
    // sessionToolHistory contains "toolName:paramHash" strings to detect same calls
    const recentCalls = sessionToolHistory.slice(-15);

    // Check for exact duplicate calls (same tool + same params) - 3 identical = loop
    if (recentCalls.length >= 3) {
      const last3 = recentCalls.slice(-3);
      if (last3[0] === last3[1] && last3[1] === last3[2]) {
        const toolName = last3[0].split(':')[0];
        setError(`Loop detected: ${toolName} called 3 times with same parameters. Use /clear to reset.`);
        updateLastMessage({ isStreaming: false });
        return;
      }
    }

    // Check for excessive calls to same tool (even with different params) - 8+ = likely loop
    const toolNameCounts = recentCalls.reduce((acc, call) => {
      const name = call.split(':')[0];
      acc[name] = (acc[name] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);

    const maxToolCalls = Math.max(...Object.values(toolNameCounts), 0);
    if (maxToolCalls >= 8) {
      const problematicTool = Object.entries(toolNameCounts).find(([_, count]) => count >= 8)?.[0];
      setError(`Loop detected: ${problematicTool} called ${maxToolCalls} times. Use /clear to reset.`);
      updateLastMessage({ isStreaming: false });
      return;
    }

    // Safety limit - reduced from 500 to 50 for faster loop detection
    if (depth > 50) {
      setError('Maximum tool iterations reached (50). Use /clear to reset.');
      updateLastMessage({ isStreaming: false });
      return;
    }

    // Compact conversation if approaching context limit (Claude Code style)
    const { messages: compactedHistory, wasCompacted, tokensAfter } = compactConversation(conversationHistory);
    if (wasCompacted) {
      log.info('Conversation compacted to stay within context limits');
    }
    setContextTokens(tokensAfter);

    // Make API request with full conversation history
    const response = await sendChatRequest({
      message: userMessage,
      // Send the compacted conversation - backend just passes to Claude
      conversationHistory: compactedHistory,
      accessToken,
      storeId,
      toolCallCount,
      loopDepth,
    });

    // Track state for this iteration
    let iterationText = '';
    let charCount = 0;
    let pendingTools: StreamEvent['pendingTools'] = undefined;
    // CRITICAL: This must be the raw content blocks array from backend
    let assistantContentFromBackend: unknown[] | undefined = undefined;
    // Loop tracking from backend
    let backendToolCallCount: number | undefined = undefined;
    let backendLoopDepth: number | undefined = undefined;
    // Structured data from tool results (for rendering charts/tables)
    const toolDataResults: ToolData[] = [];
    // Tools being streamed (for immediate UI feedback before tools_pending)
    const streamingTools: ToolCall[] = [];

    // Throttled update for streaming text (50ms) - balance between smoothness and responsiveness
    // Lower values = more responsive but more CPU, higher = smoother but laggy feel
    const throttledUpdate = createThrottle((text: string, chars: number) => {
      setStreamingChars(chars);
      updateLastMessage({ content: text });
    }, 50);

    // Process stream
    for await (const event of processStream(response)) {
      switch (event.type) {
        case 'text':
          if (event.text) {
            iterationText += event.text;
            charCount += event.text.length;
            // Only show current iteration's text - don't accumulate
            throttledUpdate(iterationText, charCount);
          }
          break;

        case 'tool':
          // Tool events are now for UI feedback only - the complete tool info
          // comes in tools_pending when stop_reason is 'tool_use'
          // We still show them as running for immediate feedback
          if (event.tool && event.tool.name) {
            // Collect streaming tools for display
            streamingTools.push({
              id: event.tool.id,
              name: event.tool.name,
              input: event.tool.input,
              status: 'running' as const,
            });
            updateLastMessage({
              content: iterationText,
              toolCalls: [...accumulatedTools, ...streamingTools],
            });
          }
          break;

        case 'tool_result':
          // Capture structured data from backend tool execution
          // This is the KEY event for rendering charts/tables from real data
          // NOTE: Don't update message here - wait until end to avoid duplicate renders
          if (event.toolResult) {
            toolDataResults.push({
              toolName: event.toolResult.name,
              toolId: event.toolResult.id,
              data: event.toolResult.result,
              elapsed_ms: event.toolResult.elapsed_ms,
              isError: event.toolResult.isError,
            });
          }
          break;

        case 'tools_pending':
          pendingTools = event.pendingTools;
          // Use raw content blocks from backend (includes tool_use blocks)
          assistantContentFromBackend = event.assistantContent;
          // Loop tracking from backend
          backendToolCallCount = event.toolCallCount;
          backendLoopDepth = event.loopDepth;

          // Extract text from content blocks for display (if iterationText is empty)
          if (!iterationText && assistantContentFromBackend) {
            const textFromBlocks = (assistantContentFromBackend as Array<{type?: string; text?: string}>)
              .filter(block => block.type === 'text' && block.text)
              .map(block => block.text)
              .join('\n\n');
            if (textFromBlocks) {
              iterationText = textFromBlocks;
            }
          }
          break;

        case 'usage':
          if (event.usage) {
            setUsage(prev => ({
              inputTokens: prev.inputTokens + event.usage!.input_tokens,
              outputTokens: prev.outputTokens + event.usage!.output_tokens,
            }));
          }
          break;

        case 'error':
          setError(event.error || 'Stream error');
          return;

        case 'done':
          break;
      }
    }

    // Final flush of any pending throttled updates - only show this iteration's text
    setStreamingChars(charCount);
    updateLastMessage({ content: iterationText });

    // Execute pending tools if any
    if (pendingTools && pendingTools.length > 0) {
      setToolCallCount(prev => prev + pendingTools!.length);

      // Mark tools as running
      const runningTools: ToolCall[] = pendingTools.map(t => ({
        id: t.id,
        name: t.name,
        input: t.input,
        status: 'running' as const,
      }));

      const allToolsSoFar = [...accumulatedTools, ...runningTools];
      updateLastMessage({
        content: iterationText,
        toolCalls: allToolsSoFar,
      });

      // Execute tools
      const results = await executeTools(pendingTools, {
        onTodoUpdate: setTodos,
        onAskUser: callbacks?.onAskUser,
        onPermissionRequest: callbacks?.onPermissionRequest,
        skipPermissions: callbacks?.skipPermissions,
      });

      // Capture tool results for chart rendering (client-executed tools)
      // This fills toolDataResults for MCP tools since backend doesn't send tool_result events for them
      for (const tool of pendingTools) {
        const result = results.find(r => r.tool_use_id === tool.id);
        if (result) {
          try {
            const parsed = JSON.parse(result.content);
            // Only add if not already captured from backend
            if (!toolDataResults.some(td => td.toolId === tool.id)) {
              toolDataResults.push({
                toolName: tool.name,
                toolId: tool.id,
                data: parsed,
                isError: !parsed.success,
              });
            }
          } catch {
            // Skip if not valid JSON
          }
        }
      }

      // Mark tools as completed
      const completedTools: ToolCall[] = runningTools.map(tc => {
        const result = results.find(r => r.tool_use_id === tc.id);
        if (result) {
          try {
            const parsed = JSON.parse(result.content);
            return {
              ...tc,
              status: parsed.success ? 'completed' as const : 'error' as const,
              result: parsed,
            };
          } catch {
            return { ...tc, status: 'completed' as const, result: { success: true, content: result.content } };
          }
        }
        return tc;
      });

      const newAccumulatedTools = [...accumulatedTools, ...completedTools];

      // Finalize current message with tools (mark as not streaming)
      // Include toolData from backend tool results even when we have local tools
      updateLastMessage({
        content: iterationText,
        toolCalls: newAccumulatedTools,
        toolData: toolDataResults.length > 0 ? toolDataResults : undefined,
        isStreaming: false,
      });

      // Build updated conversation history with the tool interaction
      // This is CRITICAL - Claude needs to see ALL previous tool calls, not just the latest
      const updatedHistory = [...conversationHistory];

      // Add assistant's response (includes tool_use blocks)
      // Truncate large tool_use inputs (Write content, etc.) to prevent token overflow
      if (assistantContentFromBackend && assistantContentFromBackend.length > 0) {
        const truncatedContent = truncateAssistantContent(assistantContentFromBackend);
        updatedHistory.push({ role: 'assistant', content: truncatedContent });
      }

      // Add tool results as user message
      const toolResultBlocks = results.map(r => ({
        type: 'tool_result',
        tool_use_id: r.tool_use_id,
        content: r.content,
      }));
      updatedHistory.push({ role: 'user', content: toolResultBlocks });

      // Create a NEW assistant message for the next iteration
      const nextAssistantMessage: Message = {
        id: crypto.randomUUID(),
        role: 'assistant',
        content: '',
        toolCalls: [],
        timestamp: new Date(),
        isStreaming: true,
      };
      setMessages(prev => [...prev, nextAssistantMessage]);

      // Continue agent loop with accumulated conversation
      // Update session tool history with "toolName:inputHash" for smarter loop detection
      // This allows same tool with different params (e.g., analytics with different query_type)
      const newToolEntries = completedTools.map(t => {
        // Create a simple hash of key parameters to detect duplicate calls
        const inputStr = JSON.stringify(t.input || {});
        const hash = inputStr.length > 50 ? inputStr.slice(0, 50) : inputStr;
        return `${t.name}:${hash}`;
      });
      const updatedSessionToolHistory = [...sessionToolHistory, ...newToolEntries];

      await runAgentLoop({
        userMessage,
        conversationHistory: updatedHistory,
        accessToken,
        storeId,
        callbacks,
        accumulatedContent: '',
        accumulatedTools: [], // Reset tools for new message
        depth: depth + 1,
        toolCallCount: backendToolCallCount,
        loopDepth: backendLoopDepth,
        sessionToolHistory: updatedSessionToolHistory,
      });
    } else {
      // No tools - finalize message
      updateLastMessage({
        content: iterationText,
        toolCalls: accumulatedTools,
        toolData: toolDataResults.length > 0 ? toolDataResults : undefined,
        isStreaming: false,
      });
      // Don't save history - every session is fresh
    }
  }

  // Helper to update the last assistant message
  function updateLastMessage(updates: Partial<Message>) {
    setMessages(prev => {
      const copy = [...prev];
      const lastIdx = copy.length - 1;
      if (lastIdx >= 0 && copy[lastIdx].role === 'assistant') {
        copy[lastIdx] = { ...copy[lastIdx], ...updates };
      }
      return copy;
    });
  }

  const clearMessages = useCallback(() => {
    setMessages([]);
    setError(null);
    setUsage({ inputTokens: 0, outputTokens: 0 });
    setToolCallCount(0);
    setContextTokens(0);
    setTodos([]);
    conversationIdRef.current = crypto.randomUUID();
  }, []);

  const clearError = useCallback(() => setError(null), []);

  return {
    messages,
    isStreaming,
    error,
    todos,
    usage: { ...usage, totalTokens: usage.inputTokens + usage.outputTokens },
    toolCallCount,
    contextTokens,
    streamingChars,
    sendMessage,
    clearMessages,
    clearError,
  };
}
