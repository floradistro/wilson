/**
 * ConfigView Component
 * Displays current Wilson settings and rules
 */

import { Box, Text } from 'ink';
import { COLORS } from '../theme/colors.js';
import { loadSettings, loadMemory, type WilsonSettings } from '../lib/config-loader.js';

interface ConfigViewProps {
  mode: 'settings' | 'rules';
}

export function ConfigView({ mode }: ConfigViewProps) {
  if (mode === 'settings') {
    return <SettingsView />;
  }
  return <RulesView />;
}

function SettingsView() {
  const settings = loadSettings();

  return (
    <Box flexDirection="column" padding={1}>
      <Box marginBottom={1}>
        <Text bold color={COLORS.primary}>wilson</Text>
        <Text color={COLORS.textDim}> - Settings</Text>
      </Box>

      {/* Formatting */}
      <Section title="Formatting">
        <Row label="Style" value={settings.formatting.style} />
        <Row label="Max lines" value={String(settings.formatting.maxLines)} />
        <Row label="Max bullets" value={String(settings.formatting.maxBulletPoints)} />
        <Row label="Use tables" value={settings.formatting.preferTables ? 'Yes' : 'No'} />
        <Row label="Status first" value={settings.formatting.statusFirst ? 'Yes' : 'No'} />
        <Row label="Avoid" value={settings.formatting.avoidPatterns.join(', ')} />
      </Section>

      {/* Permissions */}
      <Section title="Permissions">
        <Row label="Allow" value={settings.permissions.allow.join(', ') || '(none)'} />
        <Row label="Ask" value={settings.permissions.ask.join(', ') || '(none)'} />
        <Row label="Deny" value={settings.permissions.deny.join(', ') || '(none)'} />
      </Section>

      {/* Context */}
      <Section title="Context">
        <Row label="Max tokens" value={formatNumber(settings.context.maxTokens)} />
        <Row label="Compact at" value={formatNumber(settings.context.compactionThreshold)} />
        <Row label="Keep turns" value={String(settings.context.preserveRecentTurns)} />
      </Section>

      {/* Hooks */}
      <Section title="Hooks">
        <Row label="PreToolUse" value={`${settings.hooks.PreToolUse.length} hooks`} />
        <Row label="PostToolUse" value={`${settings.hooks.PostToolUse.length} hooks`} />
        <Row label="PreResponse" value={`${settings.hooks.PreResponse.length} hooks`} />
      </Section>

      <Box marginTop={1}>
        <Text color={COLORS.textDim}>Edit: </Text>
        <Text color={COLORS.info}>/config edit</Text>
        <Text color={COLORS.textDim}> | Press Esc to close</Text>
      </Box>
    </Box>
  );
}

function RulesView() {
  const memory = loadMemory();
  const lines = memory.split('\n').slice(0, 30); // Show first 30 lines

  return (
    <Box flexDirection="column" padding={1}>
      <Box marginBottom={1}>
        <Text bold color={COLORS.primary}>wilson</Text>
        <Text color={COLORS.textDim}> - Rules (WILSON.md)</Text>
      </Box>

      <Box flexDirection="column" marginBottom={1}>
        {lines.map((line, i) => (
          <Text key={i} color={line.startsWith('#') ? COLORS.primary : COLORS.text}>
            {line || ' '}
          </Text>
        ))}
        {memory.split('\n').length > 30 && (
          <Text color={COLORS.textDim}>... ({memory.split('\n').length - 30} more lines)</Text>
        )}
      </Box>

      <Box marginTop={1}>
        <Text color={COLORS.textDim}>Edit: </Text>
        <Text color={COLORS.info}>/rules edit</Text>
        <Text color={COLORS.textDim}> | Press Esc to close</Text>
      </Box>
    </Box>
  );
}

// Helper components

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Box flexDirection="column" marginBottom={1}>
      <Text bold color={COLORS.text}>{title}</Text>
      <Box flexDirection="column" marginLeft={2}>
        {children}
      </Box>
    </Box>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <Box>
      <Text color={COLORS.textDim}>{label.padEnd(14)}</Text>
      <Text color={COLORS.text}>{value}</Text>
    </Box>
  );
}

function formatNumber(n: number): string {
  if (n >= 1000) {
    return `${(n / 1000).toFixed(0)}K`;
  }
  return String(n);
}
