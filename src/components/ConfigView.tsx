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
// Rules View - Interactive WILSON.md editor
// =============================================================================

function RulesView({ onExit }: { onExit?: () => void }) {
  const [lines, setLines] = useState<string[]>(() => loadMemory().split('\n'));
  const [selectedLine, setSelectedLine] = useState(0);
  const [editMode, setEditMode] = useState(false);
  const [editBuffer, setEditBuffer] = useState('');
  const [dirty, setDirty] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [scrollOffset, setScrollOffset] = useState(0);
  const visibleLines = 18;

  // Keep selected line in view
  useEffect(() => {
    if (selectedLine < scrollOffset) {
      setScrollOffset(selectedLine);
    } else if (selectedLine >= scrollOffset + visibleLines) {
      setScrollOffset(selectedLine - visibleLines + 1);
    }
  }, [selectedLine, scrollOffset]);

  useInput((input, key) => {
    // Edit mode - typing into line
    if (editMode) {
      if (key.escape) {
        setEditMode(false);
        setEditBuffer('');
        return;
      }
      if (key.return) {
        // Save the edit
        setLines(prev => {
          const updated = [...prev];
          updated[selectedLine] = editBuffer;
          return updated;
        });
        setEditMode(false);
        setEditBuffer('');
        setDirty(true);
        setMessage(null);
        return;
      }
      if (key.backspace) {
        setEditBuffer(b => b.slice(0, -1));
        return;
      }
      if (key.tab) {
        // Tab = 2 spaces (common for markdown)
        setEditBuffer(b => b + '  ');
        return;
      }
      // Space and all other printable chars
      if (input && !key.ctrl && !key.meta) {
        setEditBuffer(b => b + input);
        return;
      }
      return;
    }

    // Navigation mode
    if (key.upArrow) {
      setSelectedLine(i => Math.max(0, i - 1));
      return;
    }
    if (key.downArrow) {
      setSelectedLine(i => Math.min(lines.length - 1, i + 1));
      return;
    }

    // Enter edit mode
    if (key.return || input === 'e') {
      setEditMode(true);
      setEditBuffer(lines[selectedLine] || '');
      return;
    }

    // Add new line after current (o = edit, Enter in nav = blank line)
    if (input === 'o') {
      setLines(prev => {
        const updated = [...prev];
        updated.splice(selectedLine + 1, 0, '');
        return updated;
      });
      setSelectedLine(i => i + 1);
      setEditMode(true);
      setEditBuffer('');
      setDirty(true);
      return;
    }

    // Add blank line after current (quick spacing)
    if (key.return) {
      setLines(prev => {
        const updated = [...prev];
        updated.splice(selectedLine + 1, 0, '');
        return updated;
      });
      setSelectedLine(i => i + 1);
      setDirty(true);
      return;
    }

    // Add new line before current
    if (input === 'O') {
      setLines(prev => {
        const updated = [...prev];
        updated.splice(selectedLine, 0, '');
        return updated;
      });
      setEditMode(true);
      setEditBuffer('');
      setDirty(true);
      return;
    }

    // Delete line
    if (input === 'd' && lines.length > 1) {
      setLines(prev => {
        const updated = [...prev];
        updated.splice(selectedLine, 1);
        return updated;
      });
      setSelectedLine(i => Math.min(i, lines.length - 2));
      setDirty(true);
      return;
    }

    // Save
    if (input === 's' && dirty) {
      saveRules();
      return;
    }

    // Exit
    if (key.escape) {
      if (dirty) {
        setMessage('Unsaved changes! Press s to save, Esc again to discard');
        setDirty(false);
      } else {
        onExit?.();
      }
      return;
    }
  });

  function saveRules() {
    try {
      const cwd = process.cwd();
      const rulesPath = existsSync(join(cwd, 'WILSON.md'))
        ? join(cwd, 'WILSON.md')
        : join(cwd, '.wilson', 'WILSON.md');
      writeFileSync(rulesPath, lines.join('\n'));
      clearSettingsCache();
      setDirty(false);
      setMessage('Rules saved!');
      setTimeout(() => setMessage(null), 2000);
    } catch (err) {
      setMessage(`Error saving: ${err}`);
    }
  }

  const displayLines = lines.slice(scrollOffset, scrollOffset + visibleLines);

  return (
    <Box flexDirection="column" padding={1}>
      <Box marginBottom={1}>
        <Text bold color={COLORS.primary}>wilson</Text>
        <Text color={COLORS.textDim}> - Rules (WILSON.md)</Text>
        {dirty && <Text color={COLORS.warning}> (modified)</Text>}
        {lines.length > visibleLines && (
          <Text color={COLORS.textDim}> [{scrollOffset + 1}-{Math.min(scrollOffset + visibleLines, lines.length)}/{lines.length}]</Text>
        )}
      </Box>

      <Box flexDirection="column" marginBottom={1}>
        {displayLines.map((line, i) => {
          const lineIndex = scrollOffset + i;
          const isSelected = lineIndex === selectedLine;
          const isEditing = isSelected && editMode;
          const isHeader = line.startsWith('#');

          return (
            <Box key={lineIndex}>
              <Text color={isSelected ? COLORS.primary : COLORS.textDim}>
                {isSelected ? '▸ ' : '  '}
              </Text>
              <Text color={COLORS.textDim} dimColor>
                {String(lineIndex + 1).padStart(3, ' ')}
              </Text>
              {isEditing ? (
                <Text color={COLORS.text}>
                  {editBuffer}
                  <Text color={COLORS.primary}>█</Text>
                </Text>
              ) : (
                <Text color={isHeader ? COLORS.primary : (isSelected ? COLORS.text : COLORS.textMuted)}>
                  {line || ' '}
                </Text>
              )}
            </Box>
          );
        })}
      </Box>

      <Box marginTop={1} flexDirection="column">
        {message && (
          <Text color={message.includes('Error') ? COLORS.error : COLORS.success}>{message}</Text>
        )}
        <Box>
          {editMode ? (
            <Text color={COLORS.info}>EDIT: Type to edit | Enter to save | Esc to cancel</Text>
          ) : (
            <>
              <Text color={COLORS.textDim}>↑↓ nav | e edit | Enter blank | o/O new line | d del | </Text>
              {dirty && <Text color={COLORS.warning}>s save | </Text>}
              <Text color={COLORS.textDim}>Esc</Text>
            </>
          )}
        </Box>
      </Box>
    </Box>
  );
}
