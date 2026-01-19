import { Box, Text } from 'ink';
import { COLORS } from '../theme/colors.js';
import type { AIProvider } from '../providers/types.js';

interface HeaderProps {
  storeName?: string | null;
  locationName?: string | null;
  isConnected?: boolean;
  aiProvider?: AIProvider;
  aiModel?: string;
}

// Get short model name for display
function getShortModelName(model?: string): string {
  if (!model) return '';
  if (model.includes('opus-4')) return 'Opus 4';
  if (model.includes('sonnet-4')) return 'Sonnet 4';
  if (model.includes('3-5-sonnet')) return '3.5 Sonnet';
  if (model.includes('3-5-haiku')) return '3.5 Haiku';
  if (model.includes('2.0-flash-thinking')) return '2.0 Think';
  if (model.includes('2.0-flash')) return '2.0 Flash';
  if (model.includes('1.5-pro')) return '1.5 Pro';
  if (model.includes('gpt-4o-mini')) return '4o Mini';
  if (model.includes('gpt-4o')) return 'GPT-4o';
  if (model.includes('o1')) return 'o1';
  return model.split('-').slice(-2).join(' ');
}

/**
 * Simple, stable header inspired by Claude Code
 * Uses single-line text components to avoid layout issues
 */
export function Header({ storeName, locationName, isConnected = true, aiProvider, aiModel }: HeaderProps) {
  // Build header text as single string for stability
  const store = storeName || 'ready';
  const loc = locationName ? ` > ${locationName}` : '';
  const status = isConnected ? '●' : '○';
  const modelShort = getShortModelName(aiModel);
  const aiInfo = aiProvider && modelShort ? ` [${modelShort}]` : '';

  return (
    <Box flexDirection="column">
      <Text>
        <Text color={COLORS.primary} bold>wilson</Text>
        <Text color={COLORS.textMuted}> · </Text>
        <Text color={COLORS.text}>{store}</Text>
        <Text color={COLORS.textDim}>{loc}</Text>
        <Text color={COLORS.textDim}>{aiInfo}</Text>
        <Text color={COLORS.textMuted}> </Text>
        <Text color={isConnected ? COLORS.success : COLORS.error}>{status}</Text>
      </Text>
    </Box>
  );
}
