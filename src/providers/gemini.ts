// =============================================================================
// Gemini Provider - Google AI integration
// =============================================================================

import type {
  IAIProvider,
  AIMessage,
  AITool,
  AIContentBlock,
  AIRequestOptions,
  AIResponse,
  AIStreamEvent,
} from './types.js';

interface GeminiConfig {
  apiKey: string;
  baseUrl?: string;
  model?: string;
}

// Gemini-specific message format
interface GeminiContent {
  role: 'user' | 'model';
  parts: GeminiPart[];
}

interface GeminiPart {
  text?: string;
  functionCall?: {
    name: string;
    args: Record<string, unknown>;
  };
  functionResponse?: {
    name: string;
    response: {
      content: string;
    };
  };
  inlineData?: {
    mimeType: string;
    data: string;
  };
}

// Gemini tool format
interface GeminiTool {
  functionDeclarations: GeminiFunctionDeclaration[];
}

interface GeminiFunctionDeclaration {
  name: string;
  description: string;
  parameters: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
  };
}

// Gemini response format
interface GeminiResponse {
  candidates: Array<{
    content: GeminiContent;
    finishReason: string;
  }>;
  usageMetadata: {
    promptTokenCount: number;
    candidatesTokenCount: number;
    totalTokenCount: number;
  };
}

export class GeminiProvider implements IAIProvider {
  readonly name = 'gemini' as const;
  readonly displayName = 'Gemini (Google)';
  readonly supportsStreaming = true;
  readonly supportsTools = true;
  readonly supportsMCP = false; // No native MCP, but tools work via adapter

  private apiKey: string;
  private baseUrl: string;
  private defaultModel: string;

  constructor(config: GeminiConfig) {
    this.apiKey = config.apiKey;
    this.baseUrl = config.baseUrl || 'https://generativelanguage.googleapis.com/v1beta';
    this.defaultModel = config.model || 'gemini-2.0-flash';
  }

  formatMessages(messages: AIMessage[]): GeminiContent[] {
    const contents: GeminiContent[] = [];

    for (const msg of messages) {
      if (msg.role === 'system') continue; // System handled separately

      const role = msg.role === 'assistant' ? 'model' : 'user';
      const parts: GeminiPart[] = [];

      if (typeof msg.content === 'string') {
        parts.push({ text: msg.content });
      } else {
        for (const block of msg.content) {
          parts.push(this.formatContentBlock(block));
        }
      }

      contents.push({ role, parts });
    }

    return contents;
  }

  private formatContentBlock(block: AIContentBlock): GeminiPart {
    switch (block.type) {
      case 'text':
        return { text: block.text };
      case 'tool_use':
        return {
          functionCall: {
            name: block.name!,
            args: block.input!,
          },
        };
      case 'tool_result':
        return {
          functionResponse: {
            name: block.tool_use_id!.split('_')[0], // Extract tool name from ID
            response: {
              content: block.content || '',
            },
          },
        };
      case 'image':
        return {
          inlineData: {
            mimeType: block.source?.media_type || 'image/png',
            data: block.source?.data || '',
          },
        };
      default:
        return { text: '' };
    }
  }

  formatTools(tools: AITool[]): GeminiTool[] {
    return [{
      functionDeclarations: tools.map(tool => {
        const params = tool.parameters as { properties?: Record<string, unknown>; required?: string[] };
        return {
          name: tool.name,
          description: tool.description,
          parameters: {
            type: 'object' as const,
            properties: params.properties || {},
            required: params.required,
          },
        };
      }),
    }];
  }

  private getSystemInstruction(messages: AIMessage[]): string | undefined {
    const systemMsg = messages.find(m => m.role === 'system');
    if (!systemMsg) return undefined;
    return typeof systemMsg.content === 'string'
      ? systemMsg.content
      : systemMsg.content.map(b => b.text || '').join('\n');
  }

  async chat(options: AIRequestOptions): Promise<AIResponse> {
    const body: Record<string, unknown> = {
      contents: this.formatMessages(options.messages),
      generationConfig: {
        maxOutputTokens: options.maxTokens || 8192,
        temperature: options.temperature ?? 0.7,
      },
    };

    // System instruction
    const systemInstruction = options.systemPrompt || this.getSystemInstruction(options.messages);
    if (systemInstruction) {
      body.systemInstruction = { parts: [{ text: systemInstruction }] };
    }

    // Tools
    if (options.tools && options.tools.length > 0) {
      body.tools = this.formatTools(options.tools);
      // Enable automatic function calling
      body.toolConfig = {
        functionCallingConfig: { mode: 'AUTO' },
      };
    }

    const url = `${this.baseUrl}/models/${this.defaultModel}:generateContent?key=${this.apiKey}`;

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Gemini API error: ${response.status} - ${error}`);
    }

    const data = await response.json();
    return this.parseResponse(data);
  }

  async *streamChat(options: AIRequestOptions): AsyncIterable<AIStreamEvent> {
    const body: Record<string, unknown> = {
      contents: this.formatMessages(options.messages),
      generationConfig: {
        maxOutputTokens: options.maxTokens || 8192,
        temperature: options.temperature ?? 0.7,
      },
    };

    // System instruction
    const systemInstruction = options.systemPrompt || this.getSystemInstruction(options.messages);
    if (systemInstruction) {
      body.systemInstruction = { parts: [{ text: systemInstruction }] };
    }

    // Tools
    if (options.tools && options.tools.length > 0) {
      body.tools = this.formatTools(options.tools);
      body.toolConfig = {
        functionCallingConfig: { mode: 'AUTO' },
      };
    }

    const url = `${this.baseUrl}/models/${this.defaultModel}:streamGenerateContent?key=${this.apiKey}&alt=sse`;

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Gemini API error: ${response.status} - ${error}`);
    }

    // Emit message_start
    yield {
      type: 'message_start',
      message: {
        id: `gemini_${Date.now()}`,
        model: this.defaultModel,
      },
    };

    const reader = response.body?.getReader();
    if (!reader) throw new Error('No response body');

    const decoder = new TextDecoder();
    let buffer = '';
    let contentIndex = 0;
    let totalOutputTokens = 0;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (line.startsWith('data: ')) {
          const data = line.slice(6);
          if (data === '[DONE]') continue;

          try {
            const chunk = JSON.parse(data);
            const events = this.parseStreamChunk(chunk, contentIndex);
            for (const event of events) {
              yield event;
              if (event.type === 'content_block_start') contentIndex++;
            }

            // Track usage
            if (chunk.usageMetadata?.candidatesTokenCount) {
              totalOutputTokens = chunk.usageMetadata.candidatesTokenCount;
            }
          } catch {
            // Skip invalid JSON
          }
        }
      }
    }

    // Emit message_stop with final usage
    yield {
      type: 'message_stop',
      delta: {
        type: 'message_delta',
        stop_reason: 'end_turn',
        usage: { output_tokens: totalOutputTokens },
      },
    };
  }

  private *parseStreamChunk(chunk: unknown, currentIndex: number): Generator<AIStreamEvent> {
    const c = chunk as GeminiResponse;

    if (!c.candidates?.[0]?.content?.parts) return;

    for (const part of c.candidates[0].content.parts) {
      if (part.text) {
        // Text delta
        yield {
          type: 'content_block_delta',
          index: currentIndex,
          delta: {
            type: 'text_delta',
            text: part.text,
          },
        };
      } else if (part.functionCall) {
        // Function call - emit as content_block_start + stop
        yield {
          type: 'content_block_start',
          index: currentIndex,
          content_block: {
            type: 'tool_use',
            id: `${part.functionCall.name}_${Date.now()}`,
            name: part.functionCall.name,
            input: part.functionCall.args,
          },
        };
        yield {
          type: 'content_block_stop',
          index: currentIndex,
        };
      }
    }

    // Check for finish reason
    if (c.candidates[0].finishReason) {
      const stopReason = this.mapFinishReason(c.candidates[0].finishReason);
      yield {
        type: 'message_delta',
        delta: {
          type: 'message_delta',
          stop_reason: stopReason,
        },
      };
    }
  }

  private mapFinishReason(reason: string): string {
    switch (reason) {
      case 'STOP': return 'end_turn';
      case 'MAX_TOKENS': return 'max_tokens';
      case 'SAFETY': return 'stop_sequence';
      case 'FUNCTION_CALL': return 'tool_use';
      default: return 'end_turn';
    }
  }

  parseResponse(data: unknown): AIResponse {
    const response = data as GeminiResponse;

    if (!response.candidates?.[0]) {
      throw new Error('No response candidates from Gemini');
    }

    const candidate = response.candidates[0];
    const content: AIContentBlock[] = [];

    for (const part of candidate.content.parts) {
      if (part.text) {
        content.push({ type: 'text', text: part.text });
      } else if (part.functionCall) {
        content.push({
          type: 'tool_use',
          id: `${part.functionCall.name}_${Date.now()}`,
          name: part.functionCall.name,
          input: part.functionCall.args,
        });
      }
    }

    return {
      id: `gemini_${Date.now()}`,
      model: this.defaultModel,
      content,
      stop_reason: this.mapFinishReason(candidate.finishReason) as AIResponse['stop_reason'],
      usage: {
        input_tokens: response.usageMetadata?.promptTokenCount || 0,
        output_tokens: response.usageMetadata?.candidatesTokenCount || 0,
      },
    };
  }

  parseStreamEvent(event: unknown): AIStreamEvent {
    // Gemini streaming already handled in streamChat
    return event as AIStreamEvent;
  }
}

export function createGeminiProvider(apiKey: string, options?: Partial<GeminiConfig>): GeminiProvider {
  return new GeminiProvider({
    apiKey,
    ...options,
  });
}
