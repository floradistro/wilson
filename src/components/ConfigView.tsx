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
  path: string[];
}

function SettingsView({ onExit }: { onExit?: () => void }) {
  const [settings, setSettings] = useState<WilsonSettings>(loadSettings());
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [dirty, setDirty] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const items: SettingItem[] = [
    { id: 'style', section: 'Formatting', label: 'Style', type: 'select', value: settings.formatting.style, options: ['terminal', 'markdown', 'plain'], path: ['formatting', 'style'] },
    { id: 'maxLines', section: 'Formatting', label: 'Max lines', type: 'number', value: settings.formatting.maxLines, path: ['formatting', 'maxLines'] },
    { id: 'maxBullets', section: 'Formatting', label: 'Max bullets', type: 'number', value: settings.formatting.maxBulletPoints, path: ['formatting', 'maxBulletPoints'] },
    { id: 'preferTables', section: 'Formatting', label: 'Use tables', type: 'boolean', value: settings.formatting.preferTables, path: ['formatting', 'preferTables'] },
    { id: 'statusFirst', section: 'Formatting', label: 'Status first', type: 'boolean', value: settings.formatting.statusFirst, path: ['formatting', 'statusFirst'] },
    { id: 'maxTokens', section: 'Context', label: 'Max tokens', type: 'number', value: settings.context.maxTokens, path: ['context', 'maxTokens'] },
    { id: 'compactAt', section: 'Context', label: 'Compact at', type: 'number', value: settings.context.compactionThreshold, path: ['context', 'compactionThreshold'] },
    { id: 'keepTurns', section: 'Context', label: 'Keep turns', type: 'number', value: settings.context.preserveRecentTurns, path: ['context', 'preserveRecentTurns'] },
  ];

  useInput((input, key) => {
    if (key.upArrow) {
      setSelectedIndex(i => Math.max(0, i - 1));
      return;
    }
    if (key.downArrow) {
      setSelectedIndex(i => Math.min(items.length - 1, i + 1));
      return;
    }
    if (input === ' ' || key.return) {
      const item = items[selectedIndex];
      if (item.type === 'boolean') {
        updateSetting(item.path, !item.value);
      } else if (item.type === 'select' && item.options) {
        const idx = item.options.indexOf(item.value as string);
        updateSetting(item.path, item.options[(idx + 1) % item.options.length]);
      } else if (item.type === 'number') {
        const inc = item.path.includes('maxTokens') || item.path.includes('compactionThreshold') ? 10000 : 5;
        updateSetting(item.path, (item.value as number) + inc);
      }
      return;
    }
    if ((input === '-' || key.leftArrow) && items[selectedIndex].type === 'number') {
      const item = items[selectedIndex];
      const dec = item.path.includes('maxTokens') || item.path.includes('compactionThreshold') ? 10000 : 5;
      updateSetting(item.path, Math.max(1, (item.value as number) - dec));
      return;
    }
    if ((input === '+' || input === '=' || key.rightArrow) && items[selectedIndex].type === 'number') {
      const item = items[selectedIndex];
      const inc = item.path.includes('maxTokens') || item.path.includes('compactionThreshold') ? 10000 : 5;
      updateSetting(item.path, (item.value as number) + inc);
      return;
    }
    if (input === 's' && dirty) {
      saveSettings();
      return;
    }
    if (key.escape) {
      if (dirty) {
        setMessage('Unsaved! s=save, Esc=discard');
        setDirty(false);
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
      for (let i = 0; i < path.length - 1; i++) obj = obj[path[i]];
      obj[path[path.length - 1]] = value;
      return updated;
    });
    setDirty(true);
    setMessage(null);
  }

  function saveSettings() {
    try {
      const settingsPath = join(process.cwd(), '.wilson', 'settings.json');
      writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
      clearSettingsCache();
      setDirty(false);
      setMessage('Saved!');
      setTimeout(() => setMessage(null), 2000);
    } catch (err) {
      setMessage(`Error: ${err}`);
    }
  }

  let currentSection = '';
  return (
    <Box flexDirection="column" padding={1}>
      <Box marginBottom={1}>
        <Text bold color={COLORS.primary}>wilson</Text>
        <Text color={COLORS.textDim}> - Settings</Text>
        {dirty && <Text color={COLORS.warning}> *</Text>}
      </Box>
      <Box flexDirection="column">
        {items.map((item, idx) => {
          const showSection = item.section !== currentSection;
          currentSection = item.section;
          const isSelected = idx === selectedIndex;
          return (
            <Box key={item.id} flexDirection="column">
              {showSection && <Text bold color={COLORS.text}>{item.section}</Text>}
              <Box marginLeft={2}>
                <Text color={isSelected ? COLORS.primary : COLORS.textDim}>{isSelected ? '▸ ' : '  '}</Text>
                <Text color={isSelected ? COLORS.primary : COLORS.textDim}>{item.label.padEnd(14)}</Text>
                <Text color={isSelected ? COLORS.text : COLORS.textMuted}>{formatValue(item)}</Text>
              </Box>
            </Box>
          );
        })}
      </Box>
      <Box marginTop={1}>
        {message && <Text color={message.includes('Error') ? COLORS.error : COLORS.success}>{message} </Text>}
        <Text color={COLORS.textDim}>↑↓ Space ←→ | s save | Esc</Text>
      </Box>
    </Box>
  );
}

function formatValue(item: SettingItem): string {
  if (item.type === 'boolean') return item.value ? '[ON]' : '[OFF]';
  if (item.type === 'number') {
    const n = item.value as number;
    return n >= 1000 ? `${(n / 1000).toFixed(0)}K` : String(n);
  }
  return String(item.value);
}

// =============================================================================
// Rules View - List of toggleable rules
// =============================================================================

interface Rule {
  id: string;
  text: string;
  enabled: boolean;
}

function parseRules(content: string): Rule[] {
  return content
    .split('\n')
    .filter(l => l.trim() && !l.startsWith('#'))  // Skip headers and blank lines
    .map((line, i) => {
      const disabled = line.startsWith('//') || line.startsWith('DISABLED:');
      const text = line.replace(/^\/\/\s*|^DISABLED:\s*/, '').replace(/^-\s*/, '').trim();
      return { id: `r${i}`, text, enabled: !disabled };
    })
    .filter(r => r.text.length > 0);
}

function serializeRules(rules: Rule[]): string {
  const header = `# Wilson Rules\n\n`;
  const body = rules.map(r => r.enabled ? `- ${r.text}` : `// ${r.text}`).join('\n');
  return header + body;
}

function RulesView({ onExit }: { onExit?: () => void }) {
  const [rules, setRules] = useState<Rule[]>(() => parseRules(loadMemory()));
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [editMode, setEditMode] = useState(false);
  const [editBuffer, setEditBuffer] = useState('');
  const [dirty, setDirty] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useInput((input, key) => {
    // Edit mode
    if (editMode) {
      if (key.escape) {
        setEditMode(false);
        return;
      }
      if (key.return) {
        if (editBuffer.trim()) {
          setRules(prev => {
            const updated = [...prev];
            updated[selectedIndex] = { ...updated[selectedIndex], text: editBuffer.trim() };
            return updated;
          });
          setDirty(true);
        }
        setEditMode(false);
        // Move to next line after save
        setSelectedIndex(i => Math.min(i + 1, rules.length - 1));
        return;
      }
      if (key.backspace) {
        setEditBuffer(b => b.slice(0, -1));
        return;
      }
      // All printable chars including space
      if (input) {
        setEditBuffer(b => b + input);
        return;
      }
      return;
    }

    // Navigation
    if (key.upArrow) {
      setSelectedIndex(i => Math.max(0, i - 1));
      return;
    }
    if (key.downArrow) {
      setSelectedIndex(i => Math.min(rules.length - 1, i + 1));
      return;
    }

    // Toggle with space
    if (input === ' ') {
      if (rules.length > 0) {
        setRules(prev => {
          const updated = [...prev];
          updated[selectedIndex] = { ...updated[selectedIndex], enabled: !updated[selectedIndex].enabled };
          return updated;
        });
        setDirty(true);
      }
      return;
    }

    // Edit with enter or 'e'
    if (key.return || input === 'e') {
      if (rules.length > 0) {
        setEditMode(true);
        setEditBuffer(rules[selectedIndex].text);
      }
      return;
    }

    // Add new rule
    if (input === 'a') {
      const newRule: Rule = { id: `r${Date.now()}`, text: 'New rule', enabled: true };
      setRules(prev => [...prev, newRule]);
      setSelectedIndex(rules.length);
      setEditMode(true);
      setEditBuffer('');
      setDirty(true);
      return;
    }

    // Delete
    if (input === 'd' && rules.length > 0) {
      setRules(prev => prev.filter((_, i) => i !== selectedIndex));
      setSelectedIndex(i => Math.max(0, Math.min(i, rules.length - 2)));
      setDirty(true);
      return;
    }

    // Save
    if (input === 's') {
      saveRules();
      return;
    }

    // Exit
    if (key.escape) {
      if (dirty) {
        setMessage('Unsaved! s=save, Esc=discard');
        setDirty(false);
      } else {
        onExit?.();
      }
      return;
    }
  });

  function saveRules() {
    try {
      const rulesPath = existsSync(join(process.cwd(), 'WILSON.md'))
        ? join(process.cwd(), 'WILSON.md')
        : join(process.cwd(), '.wilson', 'WILSON.md');
      writeFileSync(rulesPath, serializeRules(rules));
      clearSettingsCache();
      setDirty(false);
      setMessage('Saved!');
      setTimeout(() => setMessage(null), 2000);
    } catch (err) {
      setMessage(`Error: ${err}`);
    }
  }

  return (
    <Box flexDirection="column" padding={1}>
      <Box marginBottom={1}>
        <Text bold color={COLORS.primary}>wilson</Text>
        <Text color={COLORS.textDim}> - Rules [{rules.length}]</Text>
        {dirty && <Text color={COLORS.warning}> *</Text>}
      </Box>

      <Box flexDirection="column" marginBottom={1}>
        {rules.length === 0 ? (
          <Text color={COLORS.textDim}>No rules. Press 'a' to add.</Text>
        ) : (
          rules.slice(0, 12).map((rule, i) => {
            const isSelected = i === selectedIndex;
            const isEditing = isSelected && editMode;
            return (
              <Box key={rule.id}>
                <Text color={isSelected ? COLORS.primary : COLORS.textDim}>
                  {isSelected ? '▸' : ' '}
                </Text>
                <Text color={rule.enabled ? COLORS.success : COLORS.textDim}>
                  {rule.enabled ? '●' : '○'}
                </Text>
                <Text> </Text>
                {isEditing ? (
                  <Text color={COLORS.text}>{editBuffer}<Text color={COLORS.primary}>│</Text></Text>
                ) : (
                  <Text
                    color={isSelected ? COLORS.text : (rule.enabled ? COLORS.textMuted : COLORS.textDim)}
                    dimColor={!rule.enabled}
                  >
                    {rule.text.length > 65 ? rule.text.slice(0, 62) + '...' : rule.text}
                  </Text>
                )}
              </Box>
            );
          })
        )}
        {rules.length > 12 && <Text color={COLORS.textDim}>  +{rules.length - 12} more</Text>}
      </Box>

      <Box>
        {message && <Text color={message.includes('Error') ? COLORS.error : COLORS.success}>{message} </Text>}
        {editMode ? (
          <Text color={COLORS.textDim}>Type | Enter=save+next | Esc=cancel</Text>
        ) : (
          <Text color={COLORS.textDim}>↑↓ | Space=toggle | Enter=edit | a=add | d=del | s=save | Esc</Text>
        )}
      </Box>
    </Box>
  );
}
