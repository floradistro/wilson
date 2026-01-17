import { useState } from 'react';
import { Box, Text, useInput } from 'ink';

interface InputProps {
  value: string;
  onChange: (value: string) => void;
  onSubmit: (value: string) => void;
  placeholder?: string;
}

export function Input({ value, onChange, onSubmit, placeholder }: InputProps) {
  const [isFocused, setIsFocused] = useState(true);

  useInput((input, key) => {
    if (key.return) {
      onSubmit(value);
      return;
    }

    if (key.backspace || key.delete) {
      onChange(value.slice(0, -1));
      return;
    }

    // Ignore control characters
    if (key.ctrl || key.meta) {
      return;
    }

    // Add regular characters
    if (input && !key.escape) {
      onChange(value + input);
    }
  });

  return (
    <Box marginTop={1}>
      <Text color="green" bold>{'> '}</Text>
      <Text>
        {value || <Text dimColor>{placeholder}</Text>}
        {isFocused && <Text color="green">|</Text>}
      </Text>
    </Box>
  );
}
