import { Box, Text, useStdout } from 'ink';
import type { AIProvider } from '../providers/types.js';

interface HeaderProps {
  storeName?: string | null;
  locationName?: string | null;
  isConnected?: boolean;
  aiProvider?: AIProvider;
  aiModel?: string;
}

// Colors
const PRIMARY = '#7DC87D';
const ACCENT = '#89DDFF';
const DIM = '#555555';
const DIMMER = '#333333';

// AI Provider colors
const PROVIDER_COLORS: Record<AIProvider, string> = {
  anthropic: '#D97706',
  gemini: '#4285F4',
  openai: '#10A37F',
};

// Get short model name for display
function getShortModelName(model?: string): string {
  if (!model) return '';
  // Extract the key part: claude-sonnet-4-... -> Sonnet 4
  if (model.includes('opus-4')) return 'Opus 4';
  if (model.includes('sonnet-4')) return 'Sonnet 4';
  if (model.includes('3-5-sonnet')) return '3.5 Sonnet';
  if (model.includes('3-5-haiku')) return '3.5 Haiku';
  if (model.includes('3-opus')) return '3 Opus';
  if (model.includes('2.0-flash-thinking')) return '2.0 Think';
  if (model.includes('2.0-flash')) return '2.0 Flash';
  if (model.includes('1.5-pro')) return '1.5 Pro';
  if (model.includes('1.5-flash-8b')) return '1.5 8B';
  if (model.includes('1.5-flash')) return '1.5 Flash';
  if (model.includes('gpt-4o-mini')) return '4o Mini';
  if (model.includes('gpt-4o')) return 'GPT-4o';
  if (model.includes('o1')) return 'o1';
  return model.split('-').slice(-2).join(' ');
}

export function Header({ storeName, locationName, isConnected = true, aiProvider, aiModel }: HeaderProps) {
  const { stdout } = useStdout();
  const width = stdout?.columns || 80;

  // Content
  const store = storeName || 'ready';
  const loc = locationName || '';
  const status = isConnected ? 'online' : 'offline';
  const statusColor = isConnected ? PRIMARY : '#ff5555';

  // AI badge
  const providerIcon = aiProvider === 'anthropic' ? 'A' : aiProvider === 'gemini' ? 'G' : aiProvider === 'openai' ? 'O' : '';
  const providerColor = aiProvider ? PROVIDER_COLORS[aiProvider] : DIM;
  const modelShort = getShortModelName(aiModel);
  const aiBadge = providerIcon ? `[${providerIcon}] ${modelShort}` : '';

  // Calculate spacing
  const leftContent = `  WILSON  |  ${store}${loc ? '  >  ' + loc : ''}`;
  const rightContent = `${aiBadge}  ${status}  `;
  const middleSpace = Math.max(1, width - leftContent.length - rightContent.length);

  return (
    <Box flexDirection="column" gap={0}>
      {/* Main header line */}
      <Box>
        <Text color={DIMMER}>  </Text>
        <Text color={PRIMARY} bold>WILSON</Text>
        <Text color={DIMMER}>  |  </Text>
        <Text color={ACCENT}>{store}</Text>
        {loc && (
          <>
            <Text color={DIMMER}>  {'>'}  </Text>
            <Text color={DIM}>{loc}</Text>
          </>
        )}
        <Text>{' '.repeat(middleSpace)}</Text>
        {providerIcon && (
          <>
            <Text color={providerColor}>[{providerIcon}]</Text>
            <Text color={DIM}> {modelShort}  </Text>
          </>
        )}
        <Text color={statusColor}>{status}</Text>
        <Text color={DIMMER}>  </Text>
      </Box>

      {/* Separator line */}
      <Text color={DIMMER}>{'_'.repeat(width)}</Text>
    </Box>
  );
}
