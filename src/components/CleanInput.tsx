import React, { useState, useRef, useEffect } from 'react';
import { Box, Text, useInput } from 'ink';
import { COLORS } from '../theme/colors.js';

interface CleanInputProps {
  value: string;
  onChange: (value: string) => void;
  onAppendText?: (text: string) => void; // For paste/typing - appends text
  onSubmit: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
  // Menu navigation
  menuVisible?: boolean;
  menuItemCount?: number;
  menuSelectedIndex?: number;
  onMenuNavigate?: (delta: number) => void;
  onMenuSelect?: () => void;
  onMenuCancel?: () => void;
}

/**
 * Clean, simple input that works with Ink's native behavior.
 * Handles typing character-by-character as Ink delivers it.
 */
export function CleanInput({
  value,
  onChange,
  onAppendText,
  onSubmit,
  placeholder = 'Type your message...',
  disabled = false,
  menuVisible = false,
  menuItemCount = 0,
  menuSelectedIndex = 0,
  onMenuNavigate,
  onMenuSelect,
  onMenuCancel,
}: CleanInputProps) {
  const lastEscapeRef = useRef(0);
  const [cursorVisible, setCursorVisible] = useState(true);

  // Blinking cursor effect
  useEffect(() => {
    if (disabled) return;

    const interval = setInterval(() => {
      setCursorVisible(v => !v);
    }, 530); // Standard terminal blink rate

    return () => clearInterval(interval);
  }, [disabled]);

  useInput((input, key) => {
    if (disabled) return;

    // Menu navigation takes priority when menu is visible
    if (menuVisible) {
      if (key.upArrow) {
        onMenuNavigate?.(-1);
        return;
      }
      if (key.downArrow) {
        onMenuNavigate?.(1);
        return;
      }
      if (key.tab || key.return) {
        // Both Tab and Enter select the command
        onMenuSelect?.();
        return;
      }
      if (key.escape) {
        onMenuCancel?.();
        return;
      }
    }

    // Handle ESC - double tap to clear (when menu not visible)
    if (key.escape && !menuVisible) {
      const now = Date.now();
      const timeSinceLastEscape = now - lastEscapeRef.current;

      if (timeSinceLastEscape < 500) {
        // Double ESC within 500ms: clear input
        onChange('');
        lastEscapeRef.current = 0;
      } else {
        // First ESC: just track timing
        lastEscapeRef.current = now;
      }
      return;
    }

    // Handle submit
    if (key.return && !key.shift) {
      onSubmit(value);
      return;
    }

    // Handle newline with Shift+Enter
    if (key.return && key.shift) {
      onChange(value + '\n');
      return;
    }

    // Backspace
    if (key.backspace || key.delete) {
      if (value.length > 0) {
        onChange(value.slice(0, -1));
      }
      return;
    }

    // Clear line (Ctrl+U)
    if (key.ctrl && input === 'u') {
      onChange('');
      return;
    }

    // Normal character input (Ink delivers character-by-character)
    // When pasting, Ink sends each character quickly but separately
    if (input && !key.ctrl && !key.meta) {
      // Convert carriage returns to newlines (terminal compatibility)
      const normalized = input.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

      // Use onAppendText if available (avoids stale closure during paste)
      if (onAppendText) {
        onAppendText(normalized);
      } else {
        onChange(value + normalized);
      }
      return;
    }
  }, { isActive: !disabled });

  // Render the input
  const isEmpty = value.length === 0;
  const lines = value.split('\n');
  const lastLine = lines[lines.length - 1] || '';
  const hasMultipleLines = lines.length > 1;

  // Cursor character
  const cursor = cursorVisible && !disabled ? '▊' : ' ';

  return (
    <Box flexDirection="column">
      {hasMultipleLines ? (
        <>
          {/* Show all lines except last */}
          {lines.slice(0, -1).map((line, idx) => (
            <Text key={idx} color={COLORS.text}>
              {line}
            </Text>
          ))}
          {/* Last line with cursor */}
          <Box>
            <Text color={COLORS.text}>{lastLine}</Text>
            <Text color={COLORS.primary}>{cursor}</Text>
          </Box>
        </>
      ) : isEmpty ? (
        <Box>
          <Text color={COLORS.textDim}>{placeholder}</Text>
          <Text color={COLORS.primary}>{cursor}</Text>
        </Box>
      ) : (
        <Box>
          <Text color={COLORS.text}>{lastLine}</Text>
          <Text color={COLORS.primary}>{cursor}</Text>
        </Box>
      )}
    </Box>
  );
}
