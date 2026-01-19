import { memo } from 'react';
import { Box, Text } from 'ink';
import { getSlashCommands } from '../services/menu.js';
import { SLASH_COMMANDS, type CommandDef } from '../help/commands.js';
import { COLORS } from '../theme/colors.js';

export interface Command {
  name: string;
  aliases: string[];
  description: string;
}

// Convert CommandDef to Command for compatibility
function toCommand(cmd: CommandDef): Command {
  return {
    name: cmd.name,
    aliases: cmd.aliases,
    description: cmd.description,
  };
}

// Get commands from backend menu service, with fallback to centralized commands
export function getCommands(): Command[] {
  try {
    const backendCommands = getSlashCommands();
    if (backendCommands.length > 0) {
      return backendCommands;
    }
  } catch {
    // Fallback to static commands
  }
  return SLASH_COMMANDS.map(toCommand);
}

// Legacy export for compatibility
export const COMMANDS = SLASH_COMMANDS.map(toCommand);

export function filterCommands(query: string): Command[] {
  const commands = getCommands();
  const q = query.toLowerCase();
  if (!q) return commands;

  return commands.filter(cmd => {
    if (cmd.name.startsWith(q)) return true;
    return cmd.aliases.some(alias => alias.startsWith(q));
  });
}

interface CommandMenuProps {
  query: string; // The part after "/"
  selectedIndex: number;
  visible: boolean;
}

export const CommandMenu = memo(function CommandMenu({
  query,
  selectedIndex,
  visible,
}: CommandMenuProps) {
  if (!visible) return null;

  const filtered = filterCommands(query);

  if (filtered.length === 0) {
    return (
      <Box paddingX={1} marginBottom={0}>
        <Text color={COLORS.textDim}>No commands match "/{query}"</Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column" paddingX={1} marginBottom={0}>
      <Box marginBottom={0}>
        <Text color={COLORS.textMuted}>Commands</Text>
        <Text color={COLORS.textVeryDim}> (↑↓ navigate, Tab complete, Enter select, Esc cancel)</Text>
      </Box>
      <Box flexDirection="column">
        {filtered.slice(0, 8).map((cmd, i) => {
          const isSelected = i === selectedIndex;
          return (
            <Box key={cmd.name}>
              <Text color={isSelected ? COLORS.primary : COLORS.textDim}>
                {isSelected ? '▸' : ' '}
              </Text>
              <Text color={isSelected ? COLORS.primary : COLORS.textMuted} bold={isSelected}>
                {' /'}
                {cmd.name}
              </Text>
              {cmd.aliases.length > 0 && (
                <Text color={COLORS.textVeryDim}> ({cmd.aliases.join(', ')})</Text>
              )}
              <Text color={COLORS.textDim}> - {cmd.description}</Text>
            </Box>
          );
        })}
      </Box>
    </Box>
  );
});
