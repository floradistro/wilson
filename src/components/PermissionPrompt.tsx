import { Box, Text, useInput } from 'ink';

interface PermissionPromptProps {
  operation: string;
  command: string;
  onAllow: () => void;
  onDeny: () => void;
}

export function PermissionPrompt({ operation, command, onAllow, onDeny }: PermissionPromptProps) {
  useInput((char, key) => {
    if (char === 'y' || char === 'Y') {
      onAllow();
      return;
    }
    if (char === 'n' || char === 'N' || key.escape) {
      onDeny();
      return;
    }
  });

  const truncatedCommand = command.length > 60 ? command.substring(0, 57) + '...' : command;

  return (
    <Box flexDirection="column" marginY={1}>
      <Box>
        <Text color="yellow">!</Text>
        <Text bold color="white"> Dangerous operation detected: </Text>
        <Text color="yellow">{operation}</Text>
      </Box>
      <Box marginTop={1} marginLeft={2}>
        <Text dimColor>Command: </Text>
        <Text>{truncatedCommand}</Text>
      </Box>
      <Box marginTop={1}>
        <Text color="yellow">Allow?</Text>
        <Text> (y/N): </Text>
      </Box>
    </Box>
  );
}
