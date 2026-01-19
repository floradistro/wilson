import { useState, useEffect, useCallback } from 'react';
import type { AIProvider } from '../providers/types.js';
import {
  loadProviderSettings,
  saveProviderSettings,
  getApiKeyForProvider,
  type ProviderSettings,
} from '../services/storage.js';
import { AIClient, type ProviderChoice } from '../providers/index.js';

export interface UseAIProviderReturn {
  // Current state
  provider: AIProvider;
  model: string;
  displayName: string;
  isConfigured: boolean;

  // Client for direct API calls (when not using backend)
  client: AIClient | null;

  // Actions
  switchProvider: (provider: AIProvider, model?: string) => boolean;
  setModel: (model: string) => void;
  setApiKey: (provider: AIProvider, apiKey: string) => void;

  // Settings
  settings: ProviderSettings;
  getApiKey: (provider: AIProvider) => string | undefined;
}

const PROVIDER_NAMES: Record<AIProvider, string> = {
  anthropic: 'Claude',
  gemini: 'Gemini',
  openai: 'GPT-4',
};

export function useAIProvider(): UseAIProviderReturn {
  const [settings, setSettings] = useState<ProviderSettings>(() => loadProviderSettings());
  const [client, setClient] = useState<AIClient | null>(null);

  // Initialize client when settings change
  useEffect(() => {
    const apiKey = getApiKeyForProvider(settings.provider);
    if (apiKey) {
      try {
        const newClient = new AIClient({
          provider: settings.provider,
          apiKey,
          model: settings.model,
        });
        setClient(newClient);
      } catch {
        setClient(null);
      }
    } else {
      setClient(null);
    }
  }, [settings.provider, settings.model]);

  const switchProvider = useCallback((provider: AIProvider, model?: string): boolean => {
    // Check if we have an API key for this provider
    const apiKey = getApiKeyForProvider(provider);

    // Get default model for provider if not specified
    const newModel = model || getDefaultModel(provider);

    // Update settings
    const newSettings: ProviderSettings = {
      ...settings,
      provider,
      model: newModel,
    };

    setSettings(newSettings);
    saveProviderSettings(newSettings);

    return !!apiKey; // Return true if configured
  }, [settings]);

  const setModel = useCallback((model: string) => {
    const newSettings = { ...settings, model };
    setSettings(newSettings);
    saveProviderSettings(newSettings);
  }, [settings]);

  const setApiKey = useCallback((provider: AIProvider, apiKey: string) => {
    const keyField = `${provider}ApiKey` as keyof ProviderSettings;
    const newSettings = { ...settings, [keyField]: apiKey };
    setSettings(newSettings);
    saveProviderSettings(newSettings);
  }, [settings]);

  const isConfigured = !!getApiKeyForProvider(settings.provider);

  return {
    provider: settings.provider,
    model: settings.model,
    displayName: PROVIDER_NAMES[settings.provider],
    isConfigured,
    client,
    switchProvider,
    setModel,
    setApiKey,
    settings,
    getApiKey: getApiKeyForProvider,
  };
}

function getDefaultModel(provider: AIProvider): string {
  switch (provider) {
    case 'anthropic':
      return 'claude-sonnet-4-20250514';
    case 'gemini':
      return 'gemini-2.0-flash';
    case 'openai':
      return 'gpt-4o';
    default:
      return 'claude-sonnet-4-20250514';
  }
}

// Export for use in components
export type { ProviderChoice };
