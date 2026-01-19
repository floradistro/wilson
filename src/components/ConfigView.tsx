/**
 * ConfigView Component
 * Interactive settings and rules editor
 */

import { useState, useEffect } from 'react';
import { Box, Text, useInput } from 'ink';
import { writeFileSync, existsSync } from 'fs';
import { join } from 'path';
import { COLORS } from '../theme/colors.js';
import { loadSettings, loadMemory, clearSettingsCache, type WilsonSettings } from '../lib/config-loader.js';

interface ConfigViewProps {
  mode: 'settings' | 'rules';
  onExit?: () => void;
}

export function ConfigView({ mode, onExit }: ConfigViewProps) {
  if (mode === 'settings') {
    return <SettingsView onExit={onExit} />;
  }
  return <RulesView onExit={onExit} />;
}

// =============================================================================
// Settings View - Interactive toggles
// =============================================================================

interface SettingItem {
  id: string;
  section: string;
  label: string;
  type: 'boolean' | 'number' | 'select' | 'readonly';
  value: unknown;
  options?: string[];
  path: string[]; // Path in settings object
}

function SettingsView({ onExit }: { onExit?: () => void }) {
  const [settings, setSettings] = useState<WilsonSettings>(loadSettings());
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [dirty, setDirty] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  // Build flat list of editable settings
  const items: SettingItem[] = [
    // Formatting
    { id: 'style', section: 'Formatting', label: 'Style', type: 'select', value: settings.formatting.style, options: ['terminal', 'markdown', 'plain'], path: ['formatting', 'style'] },
    { id: 'maxLines', section: 'Formatting', label: 'Max lines', type: 'number', value: settings.formatting.maxLines, path: ['formatting', 'maxLines'] },
    { id: 'maxBullets', section: 'Formatting', label: 'Max bullets', type: 'number', value: settings.formatting.maxBulletPoints, path: ['formatting', 'maxBulletPoints'] },
    { id: 'preferTables', section: 'Formatting', label: 'Use tables', type: 'boolean', value: settings.formatting.preferTables, path: ['formatting', 'preferTables'] },
    { id: 'statusFirst', section: 'Formatting', label: 'Status first', type: 'boolean', value: settings.formatting.statusFirst, path: ['formatting', 'statusFirst'] },
    // Context
    { id: 'maxTokens', section: 'Context', label: 'Max tokens', type: 'number', value: settings.context.maxTokens, path: ['context', 'maxTokens'] },
    { id: 'compactAt', section: 'Context', label: 'Compact at', type: 'number', value: settings.context.compactionThreshold, path: ['context', 'compactionThreshold'] },
    { id: 'keepTurns', section: 'Context', label: 'Keep turns', type: 'number', value: settings.context.preserveRecentTurns, path: ['context', 'preserveRecentTurns'] },
    // Hooks (readonly)
    { id: 'preToolHooks', section: 'Hooks', label: 'PreToolUse', type: 'readonly', value: `${settings.hooks.PreToolUse.length} hooks`, path: [] },
    { id: 'postToolHooks', section: 'Hooks', label: 'PostToolUse', type: 'readonly', value: `${settings.hooks.PostToolUse.length} hooks`, path: [] },
  ];

  const editableItems = items.filter(i => i.type !== 'readonly');

  useInput((input, key) => {
    // Navigation
    if (key.upArrow) {
      setSelectedIndex(i => Math.max(0, i - 1));
      return;
    }
    if (key.downArrow) {
      setSelectedIndex(i => Math.min(items.length - 1, i + 1));
      return;
    }

    // Toggle/Edit on Enter or Space
    if (input === ' ' || key.return) {
      const item = items[selectedIndex];
      if (item.type === 'readonly') return;

      if (item.type === 'boolean') {
        updateSetting(item.path, !item.value);
      } else if (item.type === 'select' && item.options) {
        const currentIdx = item.options.indexOf(item.value as string);
        const nextIdx = (currentIdx + 1) % item.options.length;
        updateSetting(item.path, item.options[nextIdx]);
      } else if (item.type === 'number') {
        // Increment by 5 for tokens, 1 for others
        const increment = item.path.includes('maxTokens') || item.path.includes('compactionThreshold') ? 10000 : 5;
        updateSetting(item.path, (item.value as number) + increment);
      }
      return;
    }

    // Decrease number with - or left arrow
    if ((input === '-' || key.leftArrow) && items[selectedIndex].type === 'number') {
      const item = items[selectedIndex];
      const decrement = item.path.includes('maxTokens') || item.path.includes('compactionThreshold') ? 10000 : 5;
      const newValue = Math.max(1, (item.value as number) - decrement);
      updateSetting(item.path, newValue);
      return;
    }

    // Increase number with + or right arrow
    if ((input === '+' || input === '=' || key.rightArrow) && items[selectedIndex].type === 'number') {
      const item = items[selectedIndex];
      const increment = item.path.includes('maxTokens') || item.path.includes('compactionThreshold') ? 10000 : 5;
      updateSetting(item.path, (item.value as number) + increment);
      return;
    }

    // Save with 's'
    if (input === 's' && dirty) {
      saveSettings();
      return;
    }

    // Exit
    if (key.escape) {
      if (dirty) {
        setMessage('Unsaved changes! Press s to save, Esc again to discard');
        setDirty(false); // Allow second Esc to exit
      } else {
        onExit?.();
      }
      return;
    }
  });

  function updateSetting(path: string[], value: unknown) {
    setSettings(prev => {
      const updated = JSON.parse(JSON.stringify(prev));
      let obj = updated;
      for (let i = 0; i < path.length - 1; i++) {
        obj = obj[path[i]];
      }
      obj[path[path.length - 1]] = value;
      return updated;
    });
    setDirty(true);
    setMessage(null);
  }

  function saveSettings() {
    try {
      const cwd = process.cwd();
      const settingsPath = join(cwd, '.wilson', 'settings.json');
      writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
      clearSettingsCache();
      setDirty(false);
      setMessage('Settings saved!');
      setTimeout(() => setMessage(null), 2000);
    } catch (err) {
      setMessage(`Error saving: ${err}`);
    }
  }

  // Group items by section for display
  let currentSection = '';

  return (
    <Box flexDirection="column" padding={1}>
      <Box marginBottom={1}>
        <Text bold color={COLORS.primary}>wilson</Text>
        <Text color={COLORS.textDim}> - Settings</Text>
        {dirty && <Text color={COLORS.warning}> (modified)</Text>}
      </Box>

      <Box flexDirection="column">
        {items.map((item, idx) => {
          const showSection = item.section !== currentSection;
          currentSection = item.section;
          const isSelected = idx === selectedIndex;
          const isEditable = item.type !== 'readonly';

          return (
            <Box key={item.id} flexDirection="column">
              {showSection && (
                <Box marginTop={idx > 0 ? 1 : 0}>
                  <Text bold color={COLORS.text}>{item.section}</Text>
                </Box>
              )}
              <Box marginLeft={2}>
                <Text color={isSelected ? COLORS.primary : COLORS.textDim}>
                  {isSelected ? '▸ ' : '  '}
                </Text>
                <Text color={isSelected ? COLORS.primary : COLORS.textDim}>
                  {item.label.padEnd(14)}
                </Text>
                <Text color={isEditable ? (isSelected ? COLORS.text : COLORS.textMuted) : COLORS.textDim}>
                  {formatValue(item)}
                </Text>
                {isSelected && isEditable && (
                  <Text color={COLORS.textDim}>
                    {item.type === 'boolean' ? ' (space to toggle)' :
                     item.type === 'select' ? ' (space to cycle)' :
                     ' (←/→ to adjust)'}
                  </Text>
                )}
              </Box>
            </Box>
          );
        })}
      </Box>

      <Box marginTop={1} flexDirection="column">
        {message && (
          <Text color={message.includes('Error') ? COLORS.error : COLORS.success}>{message}</Text>
        )}
        <Box>
          <Text color={COLORS.textDim}>↑↓ navigate | Space/Enter edit | </Text>
          {dirty && <Text color={COLORS.warning}>s save | </Text>}
          <Text color={COLORS.textDim}>Esc exit</Text>
        </Box>
      </Box>
    </Box>
  );
}

function formatValue(item: SettingItem): string {
  if (item.type === 'boolean') {
    return item.value ? '[ON]' : '[OFF]';
  }
  if (item.type === 'number') {
    const n = item.value as number;
    if (n >= 1000) return `${(n / 1000).toFixed(0)}K`;
    return String(n);
  }
  return String(item.value);
}

// =============================================================================
// Rules View - Shows WILSON.md with edit option
// =============================================================================

function RulesView({ onExit }: { onExit?: () => void }) {
  const [memory, setMemory] = useState(loadMemory());
  const [scrollOffset, setScrollOffset] = useState(0);
  const lines = memory.split('\n');
  const visibleLines = 20;

  useInput((input, key) => {
    if (key.upArrow) {
      setScrollOffset(o => Math.max(0, o - 1));
      return;
    }
    if (key.downArrow) {
      setScrollOffset(o => Math.min(lines.length - visibleLines, o + 1));
      return;
    }
    if (key.escape) {
      onExit?.();
      return;
    }
    // 'e' to open in editor
    if (input === 'e') {
      const cwd = process.cwd();
      const rulesPath = existsSync(join(cwd, 'WILSON.md'))
        ? join(cwd, 'WILSON.md')
        : join(cwd, '.wilson', 'WILSON.md');
      const editor = process.env.EDITOR || 'nano';
      try {
        require('child_process').execSync(`${editor} ${rulesPath}`, { stdio: 'inherit' });
        clearSettingsCache();
        setMemory(loadMemory());
      } catch {
        // Editor closed or failed
      }
      return;
    }
  });

  const displayLines = lines.slice(scrollOffset, scrollOffset + visibleLines);

  return (
    <Box flexDirection="column" padding={1}>
      <Box marginBottom={1}>
        <Text bold color={COLORS.primary}>wilson</Text>
        <Text color={COLORS.textDim}> - Rules (WILSON.md)</Text>
        {lines.length > visibleLines && (
          <Text color={COLORS.textDim}> [{scrollOffset + 1}-{Math.min(scrollOffset + visibleLines, lines.length)}/{lines.length}]</Text>
        )}
      </Box>

      <Box flexDirection="column" marginBottom={1}>
        {displayLines.map((line, i) => (
          <Text key={i + scrollOffset} color={line.startsWith('#') ? COLORS.primary : COLORS.text}>
            {line || ' '}
          </Text>
        ))}
      </Box>

      <Box marginTop={1}>
        <Text color={COLORS.textDim}>↑↓ scroll | e open in editor | Esc exit</Text>
      </Box>
    </Box>
  );
}
