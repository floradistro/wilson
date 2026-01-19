// =============================================================================
// AI Provider Types - Unified interface for Anthropic/Gemini/OpenAI
// =============================================================================

import type { ToolSchema } from '../types.js';

export type AIProvider = 'anthropic' | 'gemini' | 'openai';

export interface AIProviderConfig {
  provider: AIProvider;
  apiKey: string;
  model?: string;
  baseUrl?: string;
}

// Unified message format (maps to both Anthropic and Gemini formats)
export interface AIMessage {
  role: 'user' | 'assistant' | 'system';
  content: string | AIContentBlock[];
}

export interface AIContentBlock {
  type: 'text' | 'tool_use' | 'tool_result' | 'image';
  // Text content
  text?: string;
  // Tool use (from AI)
  id?: string;
  name?: string;
  input?: Record<string, unknown>;
  // Tool result (from client)
  tool_use_id?: string;
  content?: string;
  is_error?: boolean;
  // Image content
  source?: {
    type: 'base64' | 'url';
    media_type?: string;
    data?: string;
    url?: string;
  };
}

// Unified tool format
export interface AITool {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

// Unified streaming event types
export type AIStreamEventType =
  | 'message_start'
  | 'content_block_start'
  | 'content_block_delta'
  | 'content_block_stop'
  | 'message_delta'
  | 'message_stop'
  | 'error';

export interface AIStreamEvent {
  type: AIStreamEventType;
  // Message info
  message?: {
    id: string;
    model: string;
    usage?: {
      input_tokens: number;
      output_tokens: number;
    };
  };
  // Content block info
  index?: number;
  content_block?: AIContentBlock;
  // Delta info
  delta?: {
    type: string;
    text?: string;
    partial_json?: string;
    stop_reason?: string;
    usage?: {
      output_tokens: number;
    };
  };
  // Error info
  error?: {
    type: string;
    message: string;
  };
}

// Request options
export interface AIRequestOptions {
  messages: AIMessage[];
  systemPrompt?: string;
  tools?: AITool[];
  maxTokens?: number;
  temperature?: number;
  stream?: boolean;
}

// Response types
export interface AIResponse {
  id: string;
  model: string;
  content: AIContentBlock[];
  stop_reason: 'end_turn' | 'tool_use' | 'max_tokens' | 'stop_sequence';
  usage: {
    input_tokens: number;
    output_tokens: number;
  };
}

// Provider interface - each provider must implement this
export interface IAIProvider {
  readonly name: AIProvider;
  readonly displayName: string;
  readonly supportsStreaming: boolean;
  readonly supportsTools: boolean;
  readonly supportsMCP: boolean;

  // Convert our unified format to provider-specific format
  formatMessages(messages: AIMessage[]): unknown;
  formatTools(tools: AITool[]): unknown;

  // Make API request
  chat(options: AIRequestOptions): Promise<AIResponse>;
  streamChat(options: AIRequestOptions): AsyncIterable<AIStreamEvent>;

  // Parse provider-specific response to our unified format
  parseResponse(response: unknown): AIResponse;
  parseStreamEvent(event: unknown): AIStreamEvent;
}

// Provider registry
export interface AIProviderRegistry {
  register(provider: IAIProvider): void;
  get(name: AIProvider): IAIProvider | undefined;
  list(): IAIProvider[];
  default: AIProvider;
}

// Model info
export interface AIModelInfo {
  id: string;
  name: string;
  provider: AIProvider;
  contextWindow: number;
  maxOutputTokens: number;
  supportsTools: boolean;
  supportsVision: boolean;
  costPer1kInput: number;
  costPer1kOutput: number;
}

// Default models per provider
export const DEFAULT_MODELS: Record<AIProvider, string> = {
  anthropic: 'claude-sonnet-4-20250514',
  gemini: 'gemini-2.0-flash-exp',
  openai: 'gpt-4o',
};

// Model catalog - Complete list of available models
export const MODELS: AIModelInfo[] = [
  // ==========================================================================
  // Anthropic Claude Models
  // ==========================================================================
  {
    id: 'claude-opus-4-20250514',
    name: 'Claude Opus 4',
    provider: 'anthropic',
    contextWindow: 200000,
    maxOutputTokens: 32000,
    supportsTools: true,
    supportsVision: true,
    costPer1kInput: 0.015,
    costPer1kOutput: 0.075,
  },
  {
    id: 'claude-sonnet-4-20250514',
    name: 'Claude Sonnet 4',
    provider: 'anthropic',
    contextWindow: 200000,
    maxOutputTokens: 16000,
    supportsTools: true,
    supportsVision: true,
    costPer1kInput: 0.003,
    costPer1kOutput: 0.015,
  },
  {
    id: 'claude-3-5-sonnet-20241022',
    name: 'Claude 3.5 Sonnet',
    provider: 'anthropic',
    contextWindow: 200000,
    maxOutputTokens: 8192,
    supportsTools: true,
    supportsVision: true,
    costPer1kInput: 0.003,
    costPer1kOutput: 0.015,
  },
  {
    id: 'claude-3-5-haiku-20241022',
    name: 'Claude 3.5 Haiku',
    provider: 'anthropic',
    contextWindow: 200000,
    maxOutputTokens: 8192,
    supportsTools: true,
    supportsVision: true,
    costPer1kInput: 0.0008,
    costPer1kOutput: 0.004,
  },
  {
    id: 'claude-3-opus-20240229',
    name: 'Claude 3 Opus',
    provider: 'anthropic',
    contextWindow: 200000,
    maxOutputTokens: 4096,
    supportsTools: true,
    supportsVision: true,
    costPer1kInput: 0.015,
    costPer1kOutput: 0.075,
  },
  // ==========================================================================
  // Google Gemini Models
  // ==========================================================================
  {
    id: 'gemini-2.0-flash-exp',
    name: 'Gemini 2.0 Flash',
    provider: 'gemini',
    contextWindow: 1000000,
    maxOutputTokens: 8192,
    supportsTools: true,
    supportsVision: true,
    costPer1kInput: 0.0,  // Free during preview
    costPer1kOutput: 0.0,
  },
  {
    id: 'gemini-2.0-flash-thinking-exp',
    name: 'Gemini 2.0 Flash Thinking',
    provider: 'gemini',
    contextWindow: 1000000,
    maxOutputTokens: 8192,
    supportsTools: true,
    supportsVision: true,
    costPer1kInput: 0.0,
    costPer1kOutput: 0.0,
  },
  {
    id: 'gemini-1.5-pro',
    name: 'Gemini 1.5 Pro',
    provider: 'gemini',
    contextWindow: 2000000,
    maxOutputTokens: 8192,
    supportsTools: true,
    supportsVision: true,
    costPer1kInput: 0.00125,
    costPer1kOutput: 0.005,
  },
  {
    id: 'gemini-1.5-flash',
    name: 'Gemini 1.5 Flash',
    provider: 'gemini',
    contextWindow: 1000000,
    maxOutputTokens: 8192,
    supportsTools: true,
    supportsVision: true,
    costPer1kInput: 0.000075,
    costPer1kOutput: 0.0003,
  },
  {
    id: 'gemini-1.5-flash-8b',
    name: 'Gemini 1.5 Flash 8B',
    provider: 'gemini',
    contextWindow: 1000000,
    maxOutputTokens: 8192,
    supportsTools: true,
    supportsVision: true,
    costPer1kInput: 0.0000375,
    costPer1kOutput: 0.00015,
  },
  // ==========================================================================
  // OpenAI Models (for future)
  // ==========================================================================
  {
    id: 'gpt-4o',
    name: 'GPT-4o',
    provider: 'openai',
    contextWindow: 128000,
    maxOutputTokens: 16384,
    supportsTools: true,
    supportsVision: true,
    costPer1kInput: 0.005,
    costPer1kOutput: 0.015,
  },
  {
    id: 'gpt-4o-mini',
    name: 'GPT-4o Mini',
    provider: 'openai',
    contextWindow: 128000,
    maxOutputTokens: 16384,
    supportsTools: true,
    supportsVision: true,
    costPer1kInput: 0.00015,
    costPer1kOutput: 0.0006,
  },
  {
    id: 'o1',
    name: 'o1',
    provider: 'openai',
    contextWindow: 200000,
    maxOutputTokens: 100000,
    supportsTools: false,
    supportsVision: true,
    costPer1kInput: 0.015,
    costPer1kOutput: 0.06,
  },
];

export function getModelInfo(modelId: string): AIModelInfo | undefined {
  return MODELS.find(m => m.id === modelId);
}

export function getModelsForProvider(provider: AIProvider): AIModelInfo[] {
  return MODELS.filter(m => m.provider === provider);
}
