import { memo } from 'react';
import { Box, Text } from 'ink';
import { getSlashCommands } from '../services/menu.js';

export interface Command {
  name: string;
  aliases: string[];
  description: string;
}

// Fallback commands (used before menu is fetched)
const FALLBACK_COMMANDS: Command[] = [
  { name: 'new', aliases: ['clear'], description: 'Start fresh conversation' },
  { name: 'stores', aliases: ['store'], description: 'Switch store' },
  { name: 'location', aliases: ['loc', 'locations'], description: 'Switch location' },
  { name: 'refresh', aliases: ['sync'], description: 'Sync stores from server' },
  { name: 'context', aliases: ['ctx'], description: 'Show context window usage' },
  { name: 'tokens', aliases: [], description: 'Show token usage and cost' },
  { name: 'status', aliases: [], description: 'View connection status' },
  { name: 'help', aliases: ['?'], description: 'Show help' },
  { name: 'logout', aliases: ['quit', 'exit'], description: 'Sign out' },
];

// Get commands from backend menu service, with fallback
export function getCommands(): Command[] {
  try {
    const backendCommands = getSlashCommands();
    if (backendCommands.length > 0) {
      return backendCommands;
    }
  } catch {
    // Fallback to static commands
  }
  return FALLBACK_COMMANDS;
}

// Legacy export for compatibility
export const COMMANDS = FALLBACK_COMMANDS;

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
        <Text color="#555">No commands match "/{query}"</Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column" paddingX={1} marginBottom={0}>
      <Box marginBottom={0}>
        <Text color="#666">Commands</Text>
        <Text color="#444"> (↑↓ navigate, Tab complete, Enter select, Esc cancel)</Text>
      </Box>
      <Box flexDirection="column">
        {filtered.slice(0, 8).map((cmd, i) => {
          const isSelected = i === selectedIndex;
          return (
            <Box key={cmd.name}>
              <Text color={isSelected ? '#7DC87D' : '#555'}>
                {isSelected ? '▸' : ' '}
              </Text>
              <Text color={isSelected ? '#7DC87D' : '#888'} bold={isSelected}>
                {' /'}
                {cmd.name}
              </Text>
              {cmd.aliases.length > 0 && (
                <Text color="#444"> ({cmd.aliases.join(', ')})</Text>
              )}
              <Text color="#555"> - {cmd.description}</Text>
            </Box>
          );
        })}
      </Box>
    </Box>
  );
});
