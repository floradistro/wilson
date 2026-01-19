import { useCallback } from 'react';

// Simplified stream event types
export interface StreamEvent {
  type: 'text' | 'tool' | 'tool_result' | 'tools_pending' | 'usage' | 'error' | 'done';
  text?: string;
  tool?: {
    id: string;
    name: string;
    input: Record<string, unknown>;
  };
  // STRUCTURED TOOL RESULT - contains the actual data for rendering charts/tables
  toolResult?: {
    id: string;
    name: string;
    result: unknown; // Parsed JSON data from tool execution
    elapsed_ms?: number;
    isError?: boolean;
  };
  pendingTools?: Array<{
    id: string;
    name: string;
    input: Record<string, unknown>;
  }>;
  // IMPORTANT: This must be the raw content blocks array (not a string!)
  // The backend needs the tool_use blocks to continue the conversation correctly
  assistantContent?: unknown[];
  // Loop tracking from backend - must send these back on continuation
  toolCallCount?: number;
  loopDepth?: number;
  usage?: {
    input_tokens: number;
    output_tokens: number;
  };
  error?: string;
}

export function useStream() {
  const processStream = useCallback(async function* (
    response: Response
  ): AsyncGenerator<StreamEvent> {
    if (!response.body) {
      yield { type: 'error', error: 'No response body' };
      return;
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    // Accumulate tool_use blocks during streaming (for Anthropic direct pass-through)
    const pendingToolBlocks: Array<{
      id: string;
      name: string;
      input: Record<string, unknown>;
    }> = [];
    // Track content blocks for assistant content (needed for conversation history)
    const contentBlocks: unknown[] = [];
    // Current tool block being built (input comes in deltas)
    let currentToolBlock: { id: string; name: string; inputJson: string } | null = null;
    // Accumulated text for text blocks
    let accumulatedText = '';

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          const { event, toolBlock, contentBlock, stopReason } = parseLineWithToolAccumulation(line, currentToolBlock);

          // Update current tool block state
          if (toolBlock !== undefined) {
            currentToolBlock = toolBlock;
          }

          // Accumulate content blocks for history
          if (contentBlock) {
            contentBlocks.push(contentBlock);
            // If it's a tool_use block, also add to pending tools
            if (contentBlock.type === 'tool_use') {
              pendingToolBlocks.push({
                id: contentBlock.id,
                name: contentBlock.name,
                input: contentBlock.input || {},
              });
            }
          }

          // Accumulate text for later inclusion in content blocks
          if (event?.type === 'text' && event.text) {
            accumulatedText += event.text;
          }

          // If stop_reason is tool_use, emit tools_pending with accumulated tools
          if (stopReason === 'tool_use' && pendingToolBlocks.length > 0) {
            // Build complete assistant content - text block first, then tool_use blocks
            const fullAssistantContent: unknown[] = [];
            if (accumulatedText.trim()) {
              fullAssistantContent.push({ type: 'text', text: accumulatedText });
            }
            // Add tool_use blocks from contentBlocks
            fullAssistantContent.push(...contentBlocks.filter((b: any) => b.type === 'tool_use'));

            yield {
              type: 'tools_pending',
              pendingTools: [...pendingToolBlocks],
              assistantContent: fullAssistantContent,
            };
            // Clear for next iteration (if any)
            pendingToolBlocks.length = 0;
            contentBlocks.length = 0;
            accumulatedText = '';
          }

          if (event) {
            yield event;
            if (event.type === 'done' || event.type === 'error') {
              return;
            }
          }
        }
      }

      // Process remaining buffer
      if (buffer.trim()) {
        const { event } = parseLineWithToolAccumulation(buffer, currentToolBlock);
        if (event) yield event;
      }
    } finally {
      reader.releaseLock();
    }
  }, []);

  return { processStream };
}

interface ParseResult {
  event: StreamEvent | null;
  toolBlock: { id: string; name: string; inputJson: string } | null | undefined;
  contentBlock: { type: string; id?: string; name?: string; input?: Record<string, unknown>; text?: string } | null;
  stopReason: string | null;
}

function parseLineWithToolAccumulation(
  line: string,
  currentToolBlock: { id: string; name: string; inputJson: string } | null
): ParseResult {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith(':')) {
    return { event: null, toolBlock: undefined, contentBlock: null, stopReason: null };
  }

  if (!trimmed.startsWith('data: ')) {
    return { event: null, toolBlock: undefined, contentBlock: null, stopReason: null };
  }

  const data = trimmed.slice(6);
  if (data === '[DONE]') {
    return { event: { type: 'done' }, toolBlock: undefined, contentBlock: null, stopReason: null };
  }

  try {
    const raw = JSON.parse(data);
    return normalizeWithToolAccumulation(raw, currentToolBlock);
  } catch {
    return { event: null, toolBlock: undefined, contentBlock: null, stopReason: null };
  }
}

function normalizeWithToolAccumulation(
  raw: Record<string, unknown>,
  currentToolBlock: { id: string; name: string; inputJson: string } | null
): ParseResult {
  const type = raw.type as string;
  let toolBlock: { id: string; name: string; inputJson: string } | null | undefined = undefined;
  let contentBlock: { type: string; id?: string; name?: string; input?: Record<string, unknown>; text?: string } | null = null;
  let stopReason: string | null = null;

  // Text content events
  if (type === 'text_delta' || type === 'text' || type === 'chunk') {
    const text = extractText(raw);
    if (text) return { event: { type: 'text', text }, toolBlock, contentBlock, stopReason };
    return { event: null, toolBlock, contentBlock, stopReason };
  }

  // Claude API content block delta
  if (type === 'content_block_delta') {
    const delta = raw.delta as Record<string, unknown> | undefined;
    const index = raw.index as number | undefined;

    // Text delta
    const text = delta?.text;
    if (typeof text === 'string' && text) {
      return { event: { type: 'text', text }, toolBlock, contentBlock, stopReason };
    }

    // Input JSON delta for tool_use blocks
    if (delta?.type === 'input_json_delta' && typeof delta.partial_json === 'string') {
      if (currentToolBlock) {
        // Accumulate the input JSON
        toolBlock = {
          ...currentToolBlock,
          inputJson: currentToolBlock.inputJson + delta.partial_json,
        };
      }
    }

    return { event: null, toolBlock, contentBlock, stopReason };
  }

  // Content block start - track tools
  if (type === 'content_block_start') {
    const block = raw.content_block as Record<string, unknown> | undefined;
    if (block?.type === 'tool_use') {
      // Start a new tool block
      toolBlock = {
        id: String(block.id || ''),
        name: String(block.name || ''),
        inputJson: '',
      };
      // Emit tool event for UI
      return {
        event: {
          type: 'tool',
          tool: {
            id: String(block.id || ''),
            name: String(block.name || ''),
            input: {},
          },
        },
        toolBlock,
        contentBlock: null,
        stopReason,
      };
    } else if (block?.type === 'text') {
      // Text block start - will accumulate content via deltas
    }
    return { event: null, toolBlock, contentBlock, stopReason };
  }

  // Content block stop - finalize tool block
  if (type === 'content_block_stop') {
    if (currentToolBlock) {
      // Parse the accumulated input JSON
      let input: Record<string, unknown> = {};
      if (currentToolBlock.inputJson) {
        try {
          input = JSON.parse(currentToolBlock.inputJson);
        } catch {
          // Invalid JSON, use empty object
        }
      }
      // Emit the completed content block
      contentBlock = {
        type: 'tool_use',
        id: currentToolBlock.id,
        name: currentToolBlock.name,
        input,
      };
      // Clear the current tool block
      toolBlock = null;
    }
    return { event: null, toolBlock, contentBlock, stopReason };
  }

  // Message delta - check for stop_reason
  if (type === 'message_delta') {
    const delta = raw.delta as Record<string, unknown> | undefined;
    if (delta?.stop_reason) {
      stopReason = String(delta.stop_reason);
    }
    // Also handle usage
    const usage = raw.usage as Record<string, unknown> | undefined;
    if (usage) {
      return {
        event: {
          type: 'usage',
          usage: {
            input_tokens: Number(usage.input_tokens || 0),
            output_tokens: Number(usage.output_tokens || 0),
          },
        },
        toolBlock,
        contentBlock,
        stopReason,
      };
    }
    return { event: null, toolBlock, contentBlock, stopReason };
  }

  // Pause for tools (from backend that implements agentic loop)
  if (type === 'pause_for_tools') {
    const pendingTools = raw.pending_tools as Array<Record<string, unknown>> | undefined;
    const assistantContent = raw.assistant_content as unknown[] | undefined;
    const toolCallCount = typeof raw.tool_call_count === 'number' ? raw.tool_call_count : undefined;
    const loopDepth = typeof raw.loop_depth === 'number' ? raw.loop_depth : undefined;

    return {
      event: {
        type: 'tools_pending',
        pendingTools: pendingTools?.map(t => ({
          id: String(t.id || ''),
          name: String(t.name || ''),
          input: (t.input || {}) as Record<string, unknown>,
        })),
        assistantContent,
        toolCallCount,
        loopDepth,
      },
      toolBlock,
      contentBlock,
      stopReason,
    };
  }

  // TOOL RESULT - structured data from backend tool execution
  if (type === 'tool_result' || type === 'tool_error') {
    const isError = type === 'tool_error';
    let parsedResult: unknown = null;

    const resultStr = raw.result as string | undefined;
    if (resultStr) {
      try {
        parsedResult = JSON.parse(resultStr);
      } catch {
        parsedResult = resultStr;
      }
    }

    return {
      event: {
        type: 'tool_result',
        toolResult: {
          id: String(raw.tool_id || raw.id || ''),
          name: String(raw.tool_name || raw.name || ''),
          result: parsedResult,
          elapsed_ms: typeof raw.elapsed_ms === 'number' ? raw.elapsed_ms : undefined,
          isError,
        },
      },
      toolBlock,
      contentBlock,
      stopReason,
    };
  }

  // Usage stats
  if (type === 'usage') {
    const usage = raw.usage as Record<string, unknown> | undefined;
    if (usage) {
      return {
        event: {
          type: 'usage',
          usage: {
            input_tokens: Number(usage.input_tokens || 0),
            output_tokens: Number(usage.output_tokens || 0),
          },
        },
        toolBlock,
        contentBlock,
        stopReason,
      };
    }
    return { event: null, toolBlock, contentBlock, stopReason };
  }

  // Error
  if (type === 'error') {
    return {
      event: {
        type: 'error',
        error: String(raw.error || raw.message || 'Unknown error'),
      },
      toolBlock,
      contentBlock,
      stopReason,
    };
  }

  // Done/stop events
  if (type === 'done' || type === 'message_stop') {
    return { event: { type: 'done' }, toolBlock, contentBlock, stopReason };
  }

  // Skip known non-content events
  if (['message_start', 'ping'].includes(type)) {
    return { event: null, toolBlock, contentBlock, stopReason };
  }

  // Unknown event with text content
  const text = extractText(raw);
  if (text) return { event: { type: 'text', text }, toolBlock, contentBlock, stopReason };

  return { event: null, toolBlock, contentBlock, stopReason };
}


// Extract text safely - handles string, objects, arrays
function extractText(raw: Record<string, unknown>): string | null {
  const candidates = [raw.text, raw.content, raw.delta];

  for (const val of candidates) {
    if (typeof val === 'string' && val.trim()) {
      return val;
    }
  }

  return null;
}
