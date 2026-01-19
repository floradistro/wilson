import { useState, useCallback, useRef, useEffect } from 'react';
import type { Message, ToolCall, ToolData, Todo, PendingQuestion, PendingPermission } from '../types.js';
import { useStream, type StreamEvent } from './useStream.js';
import { useTools } from './useTools.js';
import { sendChatRequest } from '../services/api.js';
import { compactConversation } from '../utils/context.js';
import { truncateAssistantContent } from '../utils/context-manager.js';
import { log } from '../utils/logger.js';

// =============================================================================
// Loop Prevention - Anthropic Best Practices
// =============================================================================
// 1. Track tool calls to detect duplicates
// 2. Hard limit on iterations (10 max)
// 3. Detect consecutive identical tools
// 4. Natural termination when Claude produces text without tools

interface ToolCallSignature {
  name: string;
  inputHash: string;
}

function hashToolInput(input: unknown): string {
  // Create a simple hash of tool input for deduplication
  const str = JSON.stringify(input || {});
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32bit integer
  }
  return hash.toString(36);
}

function createToolSignature(name: string, input: unknown): ToolCallSignature {
  return { name: name.toLowerCase(), inputHash: hashToolInput(input) };
}

function signaturesMatch(a: ToolCallSignature, b: ToolCallSignature): boolean {
  return a.name === b.name && a.inputHash === b.inputHash;
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
    // Tool deduplication - track all tool calls in this turn
    toolHistory?: ToolCallSignature[];
    lastToolSignature?: ToolCallSignature;
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
      toolHistory = [],
      lastToolSignature,
    } = params;

    // ==========================================================================
    // LOOP PREVENTION - Anthropic Best Practices
    // ==========================================================================
    // Claude Code approach: NO artificial iteration limits
    // Instead, rely on:
    // 1. Tool call deduplication (same tool + same params = blocked)
    // 2. Consecutive identical tool detection (immediate stop)
    // 3. Natural termination when Claude produces text without tools
    //
    // Only stop for truly pathological cases (50+ iterations = something broken)

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

    // Process stream - update immediately for responsive feel
    for await (const event of processStream(response)) {
      switch (event.type) {
        case 'text':
          if (event.text) {
            iterationText += event.text;
            charCount += event.text.length;
            // Update immediately - no throttling for text streaming
            setStreamingChars(charCount);
            updateLastMessage({ content: iterationText });
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

    // Final update after stream completes
    updateLastMessage({ content: iterationText });

    // Execute pending tools if any
    if (pendingTools && pendingTools.length > 0) {
      // ========================================================================
      // LOOP PREVENTION: Tool Deduplication
      // ========================================================================
      const newToolHistory = [...toolHistory];
      let newLastToolSignature: ToolCallSignature | undefined;
      const toolsToExecute: typeof pendingTools = [];
      const blockedTools: string[] = [];

      for (const tool of pendingTools) {
        const signature = createToolSignature(tool.name, tool.input);

        // Check 1: Is this tool identical to the LAST tool called? (consecutive duplicate)
        if (lastToolSignature && signaturesMatch(signature, lastToolSignature)) {
          log.warn(`Loop prevention: blocked consecutive duplicate tool call: ${tool.name}`);
          blockedTools.push(`${tool.name} (consecutive duplicate)`);
          continue;
        }

        // Check 2: Has this exact tool+params been called before in this turn?
        const isDuplicate = newToolHistory.some(prev => signaturesMatch(prev, signature));
        if (isDuplicate) {
          log.warn(`Loop prevention: blocked duplicate tool call: ${tool.name}`);
          blockedTools.push(`${tool.name} (already called with same params)`);
          continue;
        }

        // Tool is allowed - add to history and execute list
        newToolHistory.push(signature);
        newLastToolSignature = signature;
        toolsToExecute.push(tool);
      }

      // If ALL tools were blocked, stop the loop gracefully (no error shown)
      if (toolsToExecute.length === 0) {
        log.info('Loop prevention: duplicate tools blocked, completing gracefully');
        // Just finalize the message without any error - the task is done
        updateLastMessage({
          content: iterationText || 'Done.',
          toolCalls: accumulatedTools,
          isStreaming: false,
        });
        return;
      }

      setToolCallCount(prev => prev + toolsToExecute.length);

      // Mark tools as running
      const runningTools: ToolCall[] = toolsToExecute.map(t => ({
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

      // Execute tools (only non-duplicate ones)
      const results = await executeTools(toolsToExecute, {
        onTodoUpdate: setTodos,
        onAskUser: callbacks?.onAskUser,
        onPermissionRequest: callbacks?.onPermissionRequest,
        skipPermissions: callbacks?.skipPermissions,
      });

      // Capture tool results for chart rendering (client-executed tools)
      // This fills toolDataResults for MCP tools since backend doesn't send tool_result events for them
      for (const tool of toolsToExecute) {
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
      // Check for terminal actions (like dev server start) that should end the loop
      let hasTerminalAction = false;

      const completedTools: ToolCall[] = runningTools.map(tc => {
        const result = results.find(r => r.tool_use_id === tc.id);
        if (result) {
          try {
            const parsed = JSON.parse(result.content);
            // Check if this is a terminal action (e.g., dev server started)
            if (parsed._terminal) {
              hasTerminalAction = true;
            }
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
      // Anthropic recommends:
      // 1. is_error: true for failed tools
      // 2. Plain text stop instruction at START of result (not buried in JSON)
      // 3. cache_control to mark as "already seen"
      const toolResultBlocks = results.map(r => {
        let isError = false;
        let content = r.content;

        try {
          const parsed = JSON.parse(r.content);
          isError = parsed.success === false || parsed.error;

          // Put STOP instruction as PLAIN TEXT at start - Claude reads this first
          if (parsed.success) {
            content = `[TOOL COMPLETE - DO NOT CALL THIS TOOL AGAIN WITH SAME PARAMETERS]\n\n${r.content}`;
          }
        } catch {
          // Not JSON, still add stop instruction
          content = `[TOOL COMPLETE]\n\n${r.content}`;
        }

        return {
          type: 'tool_result',
          tool_use_id: r.tool_use_id,
          content,
          ...(isError ? { is_error: true } : {}),
          // Anthropic cache_control to mark this result as "already processed"
          cache_control: { type: 'ephemeral' },
        };
      });
      updatedHistory.push({ role: 'user', content: toolResultBlocks });

      // If a terminal action completed (like dev server started), STOP the loop
      // This is the key fix - don't continue asking Claude what to do next
      if (hasTerminalAction) {
        log.info('Terminal action completed (dev server), stopping loop');

        // Find the terminal action result and show it to the user
        const terminalResult = completedTools.find(tc => tc.result?._terminal);
        const terminalMessage = terminalResult?.result?.content || 'Task completed successfully.';

        // Update message with the terminal action's result as content
        updateLastMessage({
          content: iterationText || terminalMessage,
          toolCalls: newAccumulatedTools,
          toolData: toolDataResults.length > 0 ? toolDataResults : undefined,
          isStreaming: false,
        });
        return;
      }

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
      // Pass tool history for deduplication across iterations
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
        // Pass tool history for loop prevention
        toolHistory: newToolHistory,
        lastToolSignature: newLastToolSignature,
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
