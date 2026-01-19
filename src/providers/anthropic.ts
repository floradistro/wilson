// =============================================================================
// Anthropic Provider - Claude API integration
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

interface AnthropicConfig {
  apiKey: string;
  baseUrl?: string;
  model?: string;
}

// Anthropic-specific message format
interface AnthropicMessage {
  role: 'user' | 'assistant';
  content: string | AnthropicContentBlock[];
}

interface AnthropicContentBlock {
  type: 'text' | 'tool_use' | 'tool_result' | 'image';
  text?: string;
  id?: string;
  name?: string;
  input?: Record<string, unknown>;
  tool_use_id?: string;
  content?: string;
  is_error?: boolean;
  source?: {
    type: 'base64';
    media_type: string;
    data: string;
  };
}

// Anthropic tool format
interface AnthropicTool {
  name: string;
  description: string;
  input_schema: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
  };
}

export class AnthropicProvider implements IAIProvider {
  readonly name = 'anthropic' as const;
  readonly displayName = 'Claude (Anthropic)';
  readonly supportsStreaming = true;
  readonly supportsTools = true;
  readonly supportsMCP = true; // Native MCP support

  private apiKey: string;
  private baseUrl: string;
  private defaultModel: string;

  constructor(config: AnthropicConfig) {
    this.apiKey = config.apiKey;
    this.baseUrl = config.baseUrl || 'https://api.anthropic.com';
    this.defaultModel = config.model || 'claude-sonnet-4-20250514';
  }

  formatMessages(messages: AIMessage[]): AnthropicMessage[] {
    return messages
      .filter(m => m.role !== 'system') // System is handled separately
      .map(m => ({
        role: m.role as 'user' | 'assistant',
        content: typeof m.content === 'string'
          ? m.content
          : m.content.map(block => this.formatContentBlock(block)),
      }));
  }

  private formatContentBlock(block: AIContentBlock): AnthropicContentBlock {
    switch (block.type) {
      case 'text':
        return { type: 'text', text: block.text };
      case 'tool_use':
        return {
          type: 'tool_use',
          id: block.id!,
          name: block.name!,
          input: block.input!,
        };
      case 'tool_result':
        return {
          type: 'tool_result',
          tool_use_id: block.tool_use_id!,
          content: block.content,
          is_error: block.is_error,
        };
      case 'image':
        return {
          type: 'image',
          source: {
            type: 'base64',
            media_type: block.source?.media_type || 'image/png',
            data: block.source?.data || '',
          },
        };
      default:
        return { type: 'text', text: '' };
    }
  }

  formatTools(tools: AITool[]): AnthropicTool[] {
    return tools.map(tool => {
      const params = tool.parameters as { properties?: Record<string, unknown>; required?: string[] };
      return {
        name: tool.name,
        description: tool.description,
        input_schema: {
          type: 'object' as const,
          properties: params.properties || {},
          required: params.required,
        },
      };
    });
  }

  async chat(options: AIRequestOptions): Promise<AIResponse> {
    const body: Record<string, unknown> = {
      model: this.defaultModel,
      max_tokens: options.maxTokens || 4096,
      messages: this.formatMessages(options.messages),
    };

    if (options.systemPrompt) {
      body.system = options.systemPrompt;
    }

    if (options.tools && options.tools.length > 0) {
      body.tools = this.formatTools(options.tools);
    }

    if (options.temperature !== undefined) {
      body.temperature = options.temperature;
    }

    const response = await fetch(`${this.baseUrl}/v1/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': this.apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Anthropic API error: ${response.status} - ${error}`);
    }

    const data = await response.json();
    return this.parseResponse(data);
  }

  async *streamChat(options: AIRequestOptions): AsyncIterable<AIStreamEvent> {
    const body: Record<string, unknown> = {
      model: this.defaultModel,
      max_tokens: options.maxTokens || 4096,
      messages: this.formatMessages(options.messages),
      stream: true,
    };

    if (options.systemPrompt) {
      body.system = options.systemPrompt;
    }

    if (options.tools && options.tools.length > 0) {
      body.tools = this.formatTools(options.tools);
    }

    if (options.temperature !== undefined) {
      body.temperature = options.temperature;
    }

    const response = await fetch(`${this.baseUrl}/v1/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': this.apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Anthropic API error: ${response.status} - ${error}`);
    }

    const reader = response.body?.getReader();
    if (!reader) throw new Error('No response body');

    const decoder = new TextDecoder();
    let buffer = '';

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
            const event = JSON.parse(data);
            yield this.parseStreamEvent(event);
          } catch {
            // Skip invalid JSON
          }
        }
      }
    }
  }

  parseResponse(data: unknown): AIResponse {
    const response = data as {
      id: string;
      model: string;
      content: AnthropicContentBlock[];
      stop_reason: string;
      usage: { input_tokens: number; output_tokens: number };
    };

    return {
      id: response.id,
      model: response.model,
      content: response.content.map(block => this.parseContentBlock(block)),
      stop_reason: response.stop_reason as AIResponse['stop_reason'],
      usage: response.usage,
    };
  }

  private parseContentBlock(block: AnthropicContentBlock): AIContentBlock {
    switch (block.type) {
      case 'text':
        return { type: 'text', text: block.text };
      case 'tool_use':
        return {
          type: 'tool_use',
          id: block.id,
          name: block.name,
          input: block.input,
        };
      default:
        return { type: 'text', text: '' };
    }
  }

  parseStreamEvent(event: unknown): AIStreamEvent {
    const e = event as {
      type: string;
      message?: { id: string; model: string; usage?: { input_tokens: number; output_tokens: number } };
      index?: number;
      content_block?: AnthropicContentBlock;
      delta?: { type: string; text?: string; partial_json?: string; stop_reason?: string; usage?: { output_tokens: number } };
      error?: { type: string; message: string };
    };

    const result: AIStreamEvent = {
      type: e.type as AIStreamEvent['type'],
    };

    if (e.message) {
      result.message = {
        id: e.message.id,
        model: e.message.model,
        usage: e.message.usage,
      };
    }

    if (e.index !== undefined) {
      result.index = e.index;
    }

    if (e.content_block) {
      result.content_block = this.parseContentBlock(e.content_block);
    }

    if (e.delta) {
      result.delta = {
        type: e.delta.type,
        text: e.delta.text,
        partial_json: e.delta.partial_json,
        stop_reason: e.delta.stop_reason,
        usage: e.delta.usage,
      };
    }

    if (e.error) {
      result.error = e.error;
    }

    return result;
  }
}

export function createAnthropicProvider(apiKey: string, options?: Partial<AnthropicConfig>): AnthropicProvider {
  return new AnthropicProvider({
    apiKey,
    ...options,
  });
}
