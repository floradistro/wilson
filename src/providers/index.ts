// =============================================================================
// AI Provider Registry - Multi-provider support for Wilson
// =============================================================================

import { AnthropicProvider, createAnthropicProvider } from './anthropic.js';
import { GeminiProvider, createGeminiProvider } from './gemini.js';
import type {
  AIProvider,
  IAIProvider,
  AIProviderRegistry,
  AIProviderConfig,
  AIMessage,
  AITool,
  AIRequestOptions,
  AIResponse,
  AIStreamEvent,
  AIModelInfo,
} from './types.js';
import { DEFAULT_MODELS, MODELS, getModelInfo, getModelsForProvider } from './types.js';

// =============================================================================
// Provider Registry Implementation
// =============================================================================

class ProviderRegistry implements AIProviderRegistry {
  private providers = new Map<AIProvider, IAIProvider>();
  default: AIProvider = 'anthropic';

  register(provider: IAIProvider): void {
    this.providers.set(provider.name, provider);
  }

  get(name: AIProvider): IAIProvider | undefined {
    return this.providers.get(name);
  }

  list(): IAIProvider[] {
    return Array.from(this.providers.values());
  }

  setDefault(name: AIProvider): void {
    if (this.providers.has(name)) {
      this.default = name;
    }
  }
}

// Global registry instance
const registry = new ProviderRegistry();

// =============================================================================
// Provider Factory
// =============================================================================

export function createProvider(config: AIProviderConfig): IAIProvider {
  switch (config.provider) {
    case 'anthropic':
      return createAnthropicProvider(config.apiKey, {
        baseUrl: config.baseUrl,
        model: config.model,
      });

    case 'gemini':
      return createGeminiProvider(config.apiKey, {
        baseUrl: config.baseUrl,
        model: config.model,
      });

    case 'openai':
      // OpenAI provider not implemented yet
      throw new Error('OpenAI provider not implemented yet');

    default:
      throw new Error(`Unknown provider: ${config.provider}`);
  }
}

// =============================================================================
// Unified Client - Abstracts provider differences
// =============================================================================

export class AIClient {
  private provider: IAIProvider;
  private config: AIProviderConfig;

  constructor(config: AIProviderConfig) {
    this.config = config;
    this.provider = createProvider(config);
    registry.register(this.provider);
  }

  get providerName(): AIProvider {
    return this.provider.name;
  }

  get displayName(): string {
    return this.provider.displayName;
  }

  get model(): string {
    return this.config.model || DEFAULT_MODELS[this.config.provider];
  }

  get supportsStreaming(): boolean {
    return this.provider.supportsStreaming;
  }

  get supportsTools(): boolean {
    return this.provider.supportsTools;
  }

  get supportsMCP(): boolean {
    return this.provider.supportsMCP;
  }

  async chat(options: AIRequestOptions): Promise<AIResponse> {
    return this.provider.chat(options);
  }

  async *streamChat(options: AIRequestOptions): AsyncIterable<AIStreamEvent> {
    yield* this.provider.streamChat(options);
  }

  // Switch to a different provider
  switchProvider(newConfig: AIProviderConfig): void {
    this.config = newConfig;
    this.provider = createProvider(newConfig);
    registry.register(this.provider);
  }

  // Get model info
  getModelInfo(): AIModelInfo | undefined {
    return getModelInfo(this.model);
  }
}

// =============================================================================
// Provider Chooser State
// =============================================================================

export interface ProviderChoice {
  provider: AIProvider;
  model: string;
  apiKey?: string; // Optional - can use env vars
}

export interface ProviderChooserState {
  current: ProviderChoice;
  available: AIProvider[];
  models: Record<AIProvider, AIModelInfo[]>;
}

export function getProviderChooserState(current?: Partial<ProviderChoice>): ProviderChooserState {
  const defaultProvider: AIProvider = current?.provider || 'anthropic';
  const defaultModel = current?.model || DEFAULT_MODELS[defaultProvider];

  return {
    current: {
      provider: defaultProvider,
      model: defaultModel,
      apiKey: current?.apiKey,
    },
    available: ['anthropic', 'gemini'] as AIProvider[],
    models: {
      anthropic: getModelsForProvider('anthropic'),
      gemini: getModelsForProvider('gemini'),
      openai: getModelsForProvider('openai'),
    },
  };
}

// =============================================================================
// Exports
// =============================================================================

export {
  AnthropicProvider,
  GeminiProvider,
  createAnthropicProvider,
  createGeminiProvider,
  registry,
  DEFAULT_MODELS,
  MODELS,
  getModelInfo,
  getModelsForProvider,
};

export type {
  AIProvider,
  IAIProvider,
  AIProviderConfig,
  AIMessage,
  AITool,
  AIRequestOptions,
  AIResponse,
  AIStreamEvent,
  AIModelInfo,
};
