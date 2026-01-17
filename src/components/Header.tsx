import { Box, Text } from 'ink';
import { config } from '../config.js';

interface HeaderProps {
  storeName?: string | null;
  userEmail?: string | null;
  messageCount?: number;
  showHints?: boolean;
}

export function Header({ storeName, userEmail, messageCount = 0, showHints = true }: HeaderProps) {
  const userName = userEmail?.split('@')[0] || '';

  return (
    <Box flexDirection="column">
      {/* Title */}
      <Box>
        <Text bold color="#E0E0E0">wilson</Text>
        <Text color="#555555"> v{config.version}</Text>
        {storeName && <Text color="#555555"> | {storeName}</Text>}
      </Box>

      {/* User info */}
      {userName && (
        <Box>
          <Text color="#555555">logged in as </Text>
          <Text color="#808080">{userName}</Text>
        </Box>
      )}

      {/* Hints */}
      {showHints && (
        <Box>
          <Text color="#444444">type a message or /help for commands</Text>
        </Box>
      )}

      {/* Separator */}
      <Box>
        <Text color="#333333">{'─'.repeat(50)}</Text>
      </Box>
    </Box>
  );
}
