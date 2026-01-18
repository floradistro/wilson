import { useState, useCallback, useRef, useEffect } from 'react';
import type { Message, ToolCall, Todo, PendingQuestion, PendingPermission } from '../types.js';
import { useStream, type StreamEvent } from './useStream.js';
import { useTools } from './useTools.js';
import { sendChatRequest } from '../services/api.js';
import { compactConversation } from '../utils/context.js';
import { log } from '../utils/logger.js';

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
    } = params;

    // Claude Code has NO hardcoded iteration limit - bounded only by context window
    // We keep a very high safety limit just to prevent infinite loops from bugs
    if (depth > 500) {
      setError('Safety limit reached (500 iterations). Use /clear to reset.');
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
    let pendingTools: StreamEvent['pendingTools'] = undefined;
    // CRITICAL: This must be the raw content blocks array from backend
    let assistantContentFromBackend: unknown[] | undefined = undefined;
    // Loop tracking from backend
    let backendToolCallCount: number | undefined = undefined;
    let backendLoopDepth: number | undefined = undefined;

    // Process stream
    for await (const event of processStream(response)) {
      switch (event.type) {
        case 'text':
          if (event.text) {
            iterationText += event.text;
            // Update live character count for footer
            setStreamingChars(prev => prev + event.text!.length);
            // Update message content directly
            const displayText = accumulatedContent
              ? accumulatedContent + '\n\n' + iterationText
              : iterationText;
            updateLastMessage({ content: displayText });
          }
          break;

        case 'tool':
          // Skip individual tool events - we get complete tool info from tools_pending
          // This avoids duplicates with missing names
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
              .join('');
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

    // Calculate new accumulated state
    const newAccumulatedContent = accumulatedContent
      ? accumulatedContent + '\n\n' + iterationText
      : iterationText;

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
        content: newAccumulatedContent,
        toolCalls: allToolsSoFar,
      });

      // Execute tools
      const results = await executeTools(pendingTools, {
        onTodoUpdate: setTodos,
        onAskUser: callbacks?.onAskUser,
        onPermissionRequest: callbacks?.onPermissionRequest,
        skipPermissions: callbacks?.skipPermissions,
      });

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
      updateLastMessage({
        content: newAccumulatedContent,
        toolCalls: newAccumulatedTools,
      });

      // Build updated conversation history with the tool interaction
      // This is CRITICAL - Claude needs to see ALL previous tool calls, not just the latest
      const updatedHistory = [...conversationHistory];

      // Add assistant's response (includes tool_use blocks)
      if (assistantContentFromBackend && assistantContentFromBackend.length > 0) {
        updatedHistory.push({ role: 'assistant', content: assistantContentFromBackend });
      }

      // Add tool results as user message
      const toolResultBlocks = results.map(r => ({
        type: 'tool_result',
        tool_use_id: r.tool_use_id,
        content: r.content,
      }));
      updatedHistory.push({ role: 'user', content: toolResultBlocks });

      // Continue agent loop with accumulated conversation
      await runAgentLoop({
        userMessage,
        conversationHistory: updatedHistory,
        accessToken,
        storeId,
        callbacks,
        accumulatedContent: newAccumulatedContent,
        accumulatedTools: newAccumulatedTools,
        depth: depth + 1,
        toolCallCount: backendToolCallCount,
        loopDepth: backendLoopDepth,
      });
    } else {
      // No tools - finalize message
      updateLastMessage({
        content: newAccumulatedContent,
        toolCalls: accumulatedTools,
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
