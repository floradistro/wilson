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
  const [cursorPosition, setCursorPosition] = useState(value.length);
  const [lastEscapeTime, setLastEscapeTime] = useState(0);

  useInput((input, key) => {
    if (key.return) {
      onSubmit(value);
      return;
    }

    // ESC: Double tap to clear
    if (key.escape) {
      const now = Date.now();
      if (now - lastEscapeTime < 500) {
        onChange('');
        setCursorPosition(0);
        setLastEscapeTime(0);
      } else {
        setLastEscapeTime(now);
      }
      return;
    }

    // Navigation
    if (key.leftArrow) {
      setCursorPosition(Math.max(0, cursorPosition - 1));
      return;
    }

    if (key.rightArrow) {
      setCursorPosition(Math.min(value.length, cursorPosition + 1));
      return;
    }

    // Ctrl shortcuts
    if (key.ctrl && input === 'a') {
      setCursorPosition(0);
      return;
    }

    if (key.ctrl && input === 'e') {
      setCursorPosition(value.length);
      return;
    }

    if (key.ctrl && input === 'u') {
      onChange('');
      setCursorPosition(0);
      return;
    }

    // Editing
    if (key.backspace) {
      if (cursorPosition > 0) {
        onChange(value.slice(0, cursorPosition - 1) + value.slice(cursorPosition));
        setCursorPosition(cursorPosition - 1);
      }
      return;
    }

    if (key.delete) {
      if (cursorPosition < value.length) {
        onChange(value.slice(0, cursorPosition) + value.slice(cursorPosition + 1));
      }
      return;
    }

    // Ignore other control characters
    if (key.ctrl || key.meta) {
      return;
    }

    // Add regular characters at cursor position
    if (input) {
      const newValue = value.slice(0, cursorPosition) + input + value.slice(cursorPosition);
      onChange(newValue);
      setCursorPosition(cursorPosition + input.length);
    }
  });

  const beforeCursor = value.slice(0, cursorPosition);
  const atCursor = value.charAt(cursorPosition) || ' ';
  const afterCursor = value.slice(cursorPosition + 1);

  return (
    <Box marginTop={1}>
      <Text color="green" bold>{'> '}</Text>
      <Text>
        {value ? (
          <>
            {beforeCursor}
            <Text color="green" inverse>{isFocused ? atCursor : ''}</Text>
            {afterCursor}
          </>
        ) : (
          <Text dimColor>{placeholder}</Text>
        )}
      </Text>
    </Box>
  );
}
