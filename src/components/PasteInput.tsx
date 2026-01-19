import React, { useState, useRef } from 'react';
import { Box, Text, useInput } from 'ink';
import { COLORS } from '../theme/colors.js';

interface PasteInputProps {
  value: string;
  onChange: (value: string) => void;
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
 * Custom text input that properly handles bracketed paste with newlines
 */
export function PasteInput({
  value,
  onChange,
  onSubmit,
  placeholder = 'Type your message...',
  disabled = false,
  menuVisible = false,
  menuItemCount = 0,
  menuSelectedIndex = 0,
  onMenuNavigate,
  onMenuSelect,
  onMenuCancel,
}: PasteInputProps) {
  const lastEscapeRef = useRef(0);

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
      if (key.tab) {
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

    // Normal character input OR paste (Ink sends full paste as single input call)
    if (input && !key.ctrl && !key.meta) {
      // Filter out bracketed paste markers if they come through
      let cleanInput = input;
      if (cleanInput.includes('\x1b[200~') || cleanInput.includes('[200~')) {
        cleanInput = cleanInput.replace(/\x1b\[200~/g, '').replace(/\[200~/g, '');
      }
      if (cleanInput.includes('\x1b[201~') || cleanInput.includes('[201~')) {
        cleanInput = cleanInput.replace(/\x1b\[201~/g, '').replace(/\[201~/g, '');
      }

      // Append to current value (preserves newlines!)
      onChange(value + cleanInput);
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
  }, { isActive: !disabled });

  // Render the input
  const displayValue = value || placeholder;
  const lines = displayValue.split('\n');
  const isEmpty = value.length === 0;

  return (
    <Box flexDirection="column">
      {lines.map((line, idx) => (
        <Text key={idx} color={isEmpty ? COLORS.textDim : COLORS.text}>
          {line || ' '}
        </Text>
      ))}
      {!isEmpty && (
        <Text color={COLORS.primary}>│</Text>
      )}
    </Box>
  );
}
