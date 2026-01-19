import { useState, useCallback, useRef, useEffect } from 'react';
import type { Message, ToolCall, ToolData, Todo, PendingQuestion, PendingPermission } from '../types.js';
import { useStream, type StreamEvent } from './useStream.js';
import { useTools } from './useTools.js';
import { sendChatRequest } from '../services/api.js';
import { compactConversation } from '../utils/context.js';
import { truncateAssistantContent } from '../utils/context-manager.js';
import { log } from '../utils/logger.js';
import { createIterationWarning, createProgressReflectionPrompt, enhanceToolResult } from '../config/system-prompts.js';
import { toolStreamEmitter } from '../utils/tool-stream.js';

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

  // Subscribe to tool streaming events
  useEffect(() => {
    const unsubscribe = toolStreamEmitter.subscribe((event) => {
      if (event.type === 'output') {
        // Update the tool's streaming output in real-time
        setMessages(prev => {
          const copy = [...prev];
          const lastIdx = copy.length - 1;
          if (lastIdx >= 0 && copy[lastIdx].role === 'assistant' && copy[lastIdx].toolCalls) {
            const tools = copy[lastIdx].toolCalls!.map(tool => {
              if (tool.id === event.toolId && tool.status === 'running') {
                return {
                  ...tool,
                  streamingOutput: (tool.streamingOutput || '') + (event.data || ''),
                  streamingLines: event.lines,
                };
              }
              return tool;
            });
            copy[lastIdx] = { ...copy[lastIdx], toolCalls: tools };
          }
          return copy;
        });
      }
    });

    return unsubscribe;
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
    // Track recent tool names for pattern detection
    recentToolNames?: string[];
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
      recentToolNames = [],
    } = params;

    // ==========================================================================
    // SOFT ITERATION LIMITS - Anthropic Best Practices
    // ==========================================================================
    // Provide warnings and guidance at key milestones to prevent loops
    // Hard stop at 15 iterations (much lower than previous 50)

    // Hard stop at 15 iterations
    if (depth >= 15) {
      log.error(`Hard limit: ${depth} iterations exceeded`);
      setError(`Task stopped after ${depth} iterations. This may be too complex for a single request.`);
      updateLastMessage({
        content: `Task incomplete after ${depth} iterations. Please try breaking this into smaller, more specific tasks.`,
        toolCalls: accumulatedTools,
        isStreaming: false,
      });
      return;
    }

    // Soft warnings at milestones
    if (depth === 5 || depth === 10) {
      const warning = createIterationWarning(depth);
      if (warning) {
        log.warn(`Soft limit reached: depth ${depth}`);
        conversationHistory.push({
          role: 'user',
          content: warning,
        });
      }
    }

    // ==========================================================================
    // LOOP PREVENTION - Deduplication & Pattern Detection
    // ==========================================================================
    // 1. Tool call deduplication (same tool + same params = blocked)
    // 2. Consecutive identical tool detection (immediate stop)
    // 3. Natural termination when Claude produces text without tools

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
      // TOOL TRACKING (not blocking - trust the model with guidance)
      // ========================================================================
      // Track tool usage for pattern detection in hints, but DON'T block
      // Anthropic approach: Guide the model with feedback, don't prevent it
      const newToolHistory = [...toolHistory];
      let newLastToolSignature: ToolCallSignature | undefined;
      const toolsToExecute = pendingTools; // Execute ALL tools - no blocking

      // Track signatures for pattern detection in hints
      for (const tool of pendingTools) {
        const signature = createToolSignature(tool.name, tool.input);
        newToolHistory.push(signature);
        newLastToolSignature = signature;
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

      // Add tool results as user message with enhanced hints
      // Anthropic recommends:
      // 1. is_error: true for failed tools
      // 2. Plain text stop instruction at START of result (not buried in JSON)
      // 3. Specific guidance on what to do next
      // 4. cache_control to mark as "already seen"
      const toolResultBlocks = results.map(r => {
        // Find the tool that produced this result
        const tool = toolsToExecute.find(t => t.id === r.tool_use_id);
        const toolName = tool?.name || 'Unknown';

        let isError = false;
        let parsed: any = {};

        try {
          parsed = JSON.parse(r.content);
          isError = parsed.success === false || parsed.error;
        } catch {
          // Not JSON, treat as success
          parsed = { success: true, content: r.content };
        }

        // Track recent tool names for pattern detection (last 10)
        const currentRecentTools = [...recentToolNames, ...completedTools.map(t => t.name)].slice(-10);

        // Use enhanced tool result with specific guidance
        const enhancedContent = enhanceToolResult(
          toolName,
          parsed,
          depth + 1, // Next iteration
          currentRecentTools
        );

        return {
          type: 'tool_result',
          tool_use_id: r.tool_use_id,
          content: enhancedContent,
          ...(isError ? { is_error: true } : {}),
          // Anthropic cache_control to mark this result as "already processed"
          cache_control: { type: 'ephemeral' },
        };
      });
      updatedHistory.push({ role: 'user', content: toolResultBlocks });

      // Track recent tool names for pattern detection
      const newRecentToolNames = [...recentToolNames, ...toolsToExecute.map(t => t.name)].slice(-10);

      // Add progress reflection at milestones (every 5 iterations, but not at soft limit points)
      if (depth > 0 && depth % 5 === 0 && depth < 10) {
        const reflectionPrompt = createProgressReflectionPrompt(depth, newRecentToolNames);
        log.info(`Adding progress reflection at depth ${depth}`);
        updatedHistory.push({
          role: 'user',
          content: reflectionPrompt,
        });
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
        // Pass recent tool names for pattern detection
        recentToolNames: newRecentToolNames,
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
