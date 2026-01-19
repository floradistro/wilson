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

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          const event = parseLine(line);
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
        const event = parseLine(buffer);
        if (event) yield event;
      }
    } finally {
      reader.releaseLock();
    }
  }, []);

  return { processStream };
}

function parseLine(line: string): StreamEvent | null {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith(':')) return null;

  if (!trimmed.startsWith('data: ')) return null;

  const data = trimmed.slice(6);
  if (data === '[DONE]') return { type: 'done' };

  try {
    const raw = JSON.parse(data);
    return normalize(raw);
  } catch {
    return null;
  }
}

function normalize(raw: Record<string, unknown>): StreamEvent | null {
  const type = raw.type as string;

  // Text content events
  if (type === 'text_delta' || type === 'text' || type === 'chunk') {
    const text = extractText(raw);
    if (text) return { type: 'text', text };
    return null;
  }

  // Claude API content block delta
  if (type === 'content_block_delta') {
    const delta = raw.delta as Record<string, unknown> | undefined;
    const text = delta?.text;
    if (typeof text === 'string' && text) {
      return { type: 'text', text };
    }
    return null;
  }

  // Tool use events (backend sends tool_name/tool_id, Claude API sends name/id)
  if (type === 'tool_start' || type === 'tool_use') {
    return {
      type: 'tool',
      tool: {
        id: String(raw.tool_id || raw.id || raw.tool_use_id || ''),
        name: String(raw.tool_name || raw.name || ''),
        input: (raw.input || {}) as Record<string, unknown>,
      },
    };
  }

  // Content block start (might be tool)
  if (type === 'content_block_start') {
    const block = raw.content_block as Record<string, unknown> | undefined;
    if (block?.type === 'tool_use') {
      return {
        type: 'tool',
        tool: {
          id: String(block.id || ''),
          name: String(block.name || ''),
          input: {},
        },
      };
    }
    return null;
  }

  // Pause for tools - execute pending tools
  if (type === 'pause_for_tools') {
    const pendingTools = raw.pending_tools as Array<Record<string, unknown>> | undefined;
    // CRITICAL: Keep assistant_content as raw array - backend needs the tool_use blocks!
    // Converting to string loses the tool_use blocks, causing Claude to request same tools again
    const assistantContent = raw.assistant_content as unknown[] | undefined;
    // Loop tracking - must send these back to backend on continuation
    const toolCallCount = typeof raw.tool_call_count === 'number' ? raw.tool_call_count : undefined;
    const loopDepth = typeof raw.loop_depth === 'number' ? raw.loop_depth : undefined;

    return {
      type: 'tools_pending',
      pendingTools: pendingTools?.map(t => ({
        id: String(t.id || ''),
        name: String(t.name || ''),
        input: (t.input || {}) as Record<string, unknown>,
      })),
      assistantContent,
      toolCallCount,
      loopDepth,
    };
  }

  // TOOL RESULT - structured data from backend tool execution
  // This is the key event for rendering charts/tables from real data
  if (type === 'tool_result' || type === 'tool_error') {
    const isError = type === 'tool_error';
    let parsedResult: unknown = null;

    // Parse the result JSON if it's a string
    const resultStr = raw.result as string | undefined;
    if (resultStr) {
      try {
        parsedResult = JSON.parse(resultStr);
      } catch {
        // Not JSON, use raw string
        parsedResult = resultStr;
      }
    }

    return {
      type: 'tool_result',
      toolResult: {
        id: String(raw.tool_id || raw.id || ''),
        name: String(raw.tool_name || raw.name || ''),
        result: parsedResult,
        elapsed_ms: typeof raw.elapsed_ms === 'number' ? raw.elapsed_ms : undefined,
        isError,
      },
    };
  }

  // Usage stats - handle both direct usage events and message_delta with usage
  if (type === 'usage' || type === 'message_delta') {
    const usage = raw.usage as Record<string, unknown> | undefined;
    if (usage) {
      return {
        type: 'usage',
        usage: {
          input_tokens: Number(usage.input_tokens || 0),
          output_tokens: Number(usage.output_tokens || 0),
        },
      };
    }
    // message_delta without usage, skip
    if (type === 'message_delta') return null;
    return null;
  }

  // Error
  if (type === 'error') {
    return {
      type: 'error',
      error: String(raw.error || raw.message || 'Unknown error'),
    };
  }

  // Done/stop events
  if (type === 'done' || type === 'message_stop') {
    return { type: 'done' };
  }

  // Skip known non-content events
  if (['message_start', 'content_block_stop', 'ping', 'input_json_delta'].includes(type)) {
    return null;
  }

  // Unknown event with text content
  const text = extractText(raw);
  if (text) return { type: 'text', text };

  return null;
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
