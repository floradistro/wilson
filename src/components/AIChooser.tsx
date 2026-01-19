import { useState, useEffect } from 'react';
import { Box, Text, useInput } from 'ink';
import { COLORS } from '../theme/colors.js';
import type { AIProvider, AIModelInfo } from '../providers/types.js';
import { MODELS, DEFAULT_MODELS } from '../providers/types.js';

export interface ProviderChoice {
  provider: AIProvider;
  model: string;
}

interface AIChooserProps {
  current: ProviderChoice;
  onSelect: (choice: ProviderChoice) => void;
  onCancel: () => void;
}

// Provider display info
const PROVIDER_INFO: Record<AIProvider, { name: string; icon: string; color: string }> = {
  anthropic: {
    name: 'Claude',
    icon: 'A',
    color: '#D97706', // Anthropic orange
  },
  gemini: {
    name: 'Gemini',
    icon: 'G',
    color: '#4285F4', // Google blue
  },
  openai: {
    name: 'OpenAI',
    icon: 'O',
    color: '#10A37F', // OpenAI green
  },
};

// Get models grouped by provider
function getModelsByProvider(): Record<AIProvider, AIModelInfo[]> {
  return {
    anthropic: MODELS.filter(m => m.provider === 'anthropic'),
    gemini: MODELS.filter(m => m.provider === 'gemini'),
    openai: MODELS.filter(m => m.provider === 'openai'),
  };
}

export function AIChooser({ current, onSelect, onCancel }: AIChooserProps) {
  const modelsByProvider = getModelsByProvider();
  const providers: AIProvider[] = ['anthropic', 'gemini']; // Only show available providers

  // Build flat list of all models for navigation
  const allModels: Array<{ provider: AIProvider; model: AIModelInfo }> = [];
  for (const provider of providers) {
    for (const model of modelsByProvider[provider]) {
      allModels.push({ provider, model });
    }
  }

  // Find current selection index
  const currentIndex = allModels.findIndex(
    m => m.provider === current.provider && m.model.id === current.model
  );
  const [selectedIndex, setSelectedIndex] = useState(currentIndex >= 0 ? currentIndex : 0);

  useInput((input, key) => {
    if (key.escape) {
      onCancel();
      return;
    }

    if (key.upArrow) {
      setSelectedIndex(Math.max(0, selectedIndex - 1));
    } else if (key.downArrow) {
      setSelectedIndex(Math.min(allModels.length - 1, selectedIndex + 1));
    } else if (key.return) {
      const selected = allModels[selectedIndex];
      onSelect({
        provider: selected.provider,
        model: selected.model.id,
      });
    }
  });

  const formatCost = (model: AIModelInfo) => {
    if (model.costPer1kInput === 0 && model.costPer1kOutput === 0) {
      return 'Free';
    }
    const input = model.costPer1kInput < 0.001
      ? `$${(model.costPer1kInput * 1000000).toFixed(1)}/M`
      : `$${(model.costPer1kInput * 1000).toFixed(2)}/M`;
    return input;
  };

  const formatContext = (tokens: number) => {
    if (tokens >= 1000000) return `${(tokens / 1000000).toFixed(0)}M ctx`;
    return `${(tokens / 1000).toFixed(0)}K ctx`;
  };

  // Group models for display
  let currentProvider: AIProvider | null = null;

  return (
    <Box flexDirection="column" paddingX={1}>
      <Box marginBottom={1}>
        <Text bold color={COLORS.primary}>Select AI Model</Text>
        <Text color={COLORS.textDim}> - arrows to navigate, enter to select, esc to cancel</Text>
      </Box>

      <Box flexDirection="column">
        {allModels.map((item, idx) => {
          const isSelected = idx === selectedIndex;
          const isCurrent = item.provider === current.provider && item.model.id === current.model;
          const showHeader = item.provider !== currentProvider;
          currentProvider = item.provider;
          const info = PROVIDER_INFO[item.provider];

          return (
            <Box key={item.model.id} flexDirection="column">
              {/* Provider header */}
              {showHeader && (
                <Box marginTop={idx > 0 ? 1 : 0} marginBottom={0}>
                  <Text bold color={info.color}>[{info.icon}] {info.name}</Text>
                </Box>
              )}

              {/* Model row */}
              <Box>
                <Text color={isSelected ? COLORS.primary : COLORS.textDim}>
                  {isSelected ? ' > ' : '   '}
                </Text>
                <Box width={28}>
                  <Text
                    bold={isSelected}
                    color={isSelected ? COLORS.text : COLORS.textDim}
                  >
                    {item.model.name}
                  </Text>
                </Box>
                <Box width={10}>
                  <Text color={COLORS.textVeryDim}>{formatContext(item.model.contextWindow)}</Text>
                </Box>
                <Box width={12}>
                  <Text color={item.model.costPer1kInput === 0 ? COLORS.success : COLORS.textVeryDim}>
                    {formatCost(item.model)}
                  </Text>
                </Box>
                {isCurrent && (
                  <Text color={COLORS.success}> (current)</Text>
                )}
              </Box>
            </Box>
          );
        })}
      </Box>

      <Box marginTop={1} paddingTop={1} borderStyle="single" borderColor={COLORS.textVeryDim} borderTop borderBottom={false} borderLeft={false} borderRight={false}>
        <Text color={COLORS.textDim}>
          Set API keys: ANTHROPIC_API_KEY, GEMINI_API_KEY
        </Text>
      </Box>
    </Box>
  );
}

// Compact status indicator for header
export function AIModelBadge({ provider, model }: { provider: AIProvider; model: string }) {
  const info = PROVIDER_INFO[provider];
  const modelInfo = MODELS.find(m => m.id === model);
  // Get short name - last word or abbreviation
  let shortName = modelInfo?.name || model;
  if (shortName.includes(' ')) {
    const parts = shortName.split(' ');
    // For "Claude Opus 4" -> "Opus 4", for "Gemini 2.0 Flash" -> "2.0 Flash"
    if (parts[0] === 'Claude' || parts[0] === 'Gemini' || parts[0] === 'GPT-4o') {
      shortName = parts.slice(1).join(' ');
    }
  }

  return (
    <Text>
      <Text color={info.color}>[{info.icon}]</Text>
      <Text color={COLORS.textMuted}> {shortName}</Text>
    </Text>
  );
}
