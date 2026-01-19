import React, { useState, useEffect, useRef } from 'react';
import { Box, Text, useInput, Static } from 'ink';
import chalk from 'chalk';
import { COLORS } from '../theme/colors.js';
import { ICONS, SPACING } from '../theme/ui.js';
import { DESIGN_SYSTEM } from '../theme/design-system.js';
import { parseBracketedPaste } from '../utils/bracketed-paste.js';

interface EnhancedInputProps {
  value: string;
  onChange: (value: string) => void;
  onSubmit: (value: string) => void;
  placeholder?: string;
  prompt?: string;
  isLoading?: boolean;
  suggestions?: string[];
  disabled?: boolean;
  multiline?: boolean;
  maxLength?: number;
}

export function EnhancedInput({
  value,
  onChange,
  onSubmit,
  placeholder = 'Type your message...',
  prompt = 'wilson',
  isLoading = false,
  suggestions = [],
  disabled = false,
  multiline = false,
  maxLength = 500,
}: EnhancedInputProps) {
  const [isFocused, setIsFocused] = useState(true);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [selectedSuggestion, setSelectedSuggestion] = useState(0);
  const [cursorVisible, setCursorVisible] = useState(true);
  const [cursorPosition, setCursorPosition] = useState(value.length);
  const [lastEscapeTime, setLastEscapeTime] = useState(0);
  const inputRef = useRef<string>(value);

  // Update cursor position when value changes externally
  useEffect(() => {
    setCursorPosition(Math.min(cursorPosition, value.length));
  }, [value]);

  // Cursor blinking animation
  useEffect(() => {
    if (!isFocused || isLoading) return;
    
    const interval = setInterval(() => {
      setCursorVisible(v => !v);
    }, 530); // Apple-like cursor blink rate
    
    return () => clearInterval(interval);
  }, [isFocused, isLoading]);

  // Filter suggestions based on input
  const filteredSuggestions = suggestions.filter(suggestion =>
    suggestion.toLowerCase().includes(value.toLowerCase()) && 
    suggestion !== value
  ).slice(0, 5);

  useInput((input, key) => {
    if (disabled) return;

    // Handle Enter key
    if (key.return) {
      if (showSuggestions && filteredSuggestions[selectedSuggestion]) {
        const suggestion = filteredSuggestions[selectedSuggestion];
        onChange(suggestion);
        setCursorPosition(suggestion.length);
        setShowSuggestions(false);
        return;
      }

      // Shift+Enter or Option+Enter: Add newline (multi-line support)
      if (key.shift || (key.meta && !key.ctrl)) {
        const newValue = value.slice(0, cursorPosition) + '\n' + value.slice(cursorPosition);
        onChange(newValue);
        setCursorPosition(cursorPosition + 1);
        return;
      }

      // Plain Enter: Submit
      onSubmit(value);
      return;
    }

    // ESC: Double tap to clear, single tap to dismiss suggestions or stop
    if (key.escape) {
      const now = Date.now();
      const timeSinceLastEscape = now - lastEscapeTime;

      if (showSuggestions) {
        // First ESC: dismiss suggestions
        setShowSuggestions(false);
        setLastEscapeTime(now);
      } else if (timeSinceLastEscape < 500) {
        // Double ESC within 500ms: clear input
        onChange('');
        setCursorPosition(0);
        setLastEscapeTime(0);
      } else {
        // Single ESC when streaming: signal to stop (handled by parent)
        setLastEscapeTime(now);
      }
      return;
    }

    if (key.tab && filteredSuggestions.length > 0) {
      const suggestion = filteredSuggestions[selectedSuggestion] || filteredSuggestions[0];
      onChange(suggestion);
      setCursorPosition(suggestion.length);
      setShowSuggestions(false);
      return;
    }

    if (key.upArrow) {
      if (showSuggestions) {
        setSelectedSuggestion(Math.max(0, selectedSuggestion - 1));
      }
      return;
    }

    if (key.downArrow) {
      if (showSuggestions) {
        setSelectedSuggestion(Math.min(filteredSuggestions.length - 1, selectedSuggestion + 1));
      }
      return;
    }

    // Navigation keys
    if (key.leftArrow) {
      setCursorPosition(Math.max(0, cursorPosition - 1));
      return;
    }

    if (key.rightArrow) {
      setCursorPosition(Math.min(value.length, cursorPosition + 1));
      return;
    }

    // Home/End or Ctrl+A/E
    if (key.ctrl && input === 'a') {
      setCursorPosition(0);
      return;
    }

    if (key.ctrl && input === 'e') {
      setCursorPosition(value.length);
      return;
    }

    // Ctrl+U: Clear line (Unix style)
    if (key.ctrl && input === 'u') {
      onChange('');
      setCursorPosition(0);
      return;
    }

    // Ctrl+K: Kill from cursor to end
    if (key.ctrl && input === 'k') {
      const newValue = value.slice(0, cursorPosition);
      onChange(newValue);
      return;
    }

    // Ctrl+W: Delete word backwards
    if (key.ctrl && input === 'w') {
      const beforeCursor = value.slice(0, cursorPosition);
      const afterCursor = value.slice(cursorPosition);
      const words = beforeCursor.trimEnd().split(/\s+/);
      words.pop();
      const newBefore = words.join(' ') + (words.length > 0 ? ' ' : '');
      const newValue = newBefore + afterCursor;
      onChange(newValue);
      setCursorPosition(newBefore.length);
      return;
    }

    // Handle text editing
    if (key.backspace) {
      if (cursorPosition > 0) {
        const newValue = value.slice(0, cursorPosition - 1) + value.slice(cursorPosition);
        onChange(newValue);
        setCursorPosition(cursorPosition - 1);
        setShowSuggestions(newValue.length > 2 && filteredSuggestions.length > 0);
      }
      return;
    }

    if (key.delete) {
      if (cursorPosition < value.length) {
        const newValue = value.slice(0, cursorPosition) + value.slice(cursorPosition + 1);
        onChange(newValue);
        setShowSuggestions(newValue.length > 2 && filteredSuggestions.length > 0);
      }
      return;
    }

    // Regular character input
    if (input && !key.ctrl && !key.meta && value.length < maxLength) {
      // Insert text at cursor position
      const newValue = value.slice(0, cursorPosition) + input + value.slice(cursorPosition);
      onChange(newValue);
      setCursorPosition(cursorPosition + input.length);
      setShowSuggestions(newValue.length > 2 && suggestions.length > 0);
    }
  });

  // Update suggestions selection when filtered list changes
  useEffect(() => {
    if (selectedSuggestion >= filteredSuggestions.length) {
      setSelectedSuggestion(0);
    }
  }, [filteredSuggestions.length, selectedSuggestion]);

  const promptColor = isLoading 
    ? COLORS.textMuted 
    : isFocused 
      ? COLORS.primary 
      : COLORS.textDim;

  const inputColor = disabled 
    ? COLORS.textDisabled 
    : COLORS.text;

  const cursor = cursorVisible && isFocused && !isLoading ? '▊' : ' ';
  const displayValue = value || '';
  const showPlaceholder = displayValue.length === 0 && !isLoading;

  // Split text at cursor position for proper cursor rendering
  const beforeCursor = displayValue.slice(0, cursorPosition);
  const atCursor = displayValue.charAt(cursorPosition) || ' ';
  const afterCursor = displayValue.slice(cursorPosition + 1);

  // Simple single-line rendering - multi-line breaks layout
  const renderContent = () => {
    if (isLoading) {
      return (
        <Text color={COLORS.textMuted}>
          {ICONS.spinner.frames[0]} Processing...
        </Text>
      );
    }

    if (showPlaceholder) {
      return <Text color={COLORS.textDim}>{placeholder}</Text>;
    }

    // Render multi-line properly
    const lines = displayValue.split('\n');
    if (lines.length > 1) {
      // Multi-line: render each line separately
      let charsSoFar = 0;
      return (
        <Box flexDirection="column">
          {lines.map((line, idx) => {
            const lineStart = charsSoFar;
            const lineEnd = charsSoFar + line.length;
            const hasCursor = cursorPosition >= lineStart && cursorPosition <= lineEnd;

            if (hasCursor) {
              const pos = cursorPosition - lineStart;
              const before = line.slice(0, pos);
              const at = line.charAt(pos) || ' ';
              const after = line.slice(pos + 1);

              charsSoFar = lineEnd + 1;
              return (
                <Box key={idx}>
                  <Text color={inputColor}>{before}</Text>
                  <Text inverse={cursorVisible && isFocused}>{cursorVisible && isFocused ? at : ''}</Text>
                  <Text color={inputColor}>{after}</Text>
                </Box>
              );
            }

            charsSoFar = lineEnd + 1;
            return <Box key={idx}><Text color={inputColor}>{line || ' '}</Text></Box>;
          })}
        </Box>
      );
    }

    // Single line: simple rendering
    const before = displayValue.slice(0, cursorPosition);
    const at = displayValue.charAt(cursorPosition) || ' ';
    const after = displayValue.slice(cursorPosition + 1);

    return (
      <>
        <Text color={inputColor}>{before}</Text>
        <Text
          color={COLORS.primary}
          backgroundColor={cursorVisible && isFocused ? COLORS.primary : undefined}
          inverse={cursorVisible && isFocused}
        >
          {cursorVisible && isFocused ? at : ''}
        </Text>
        <Text color={inputColor}>{after}</Text>
      </>
    );
  };

  return (
    <Box flexDirection="column">
      {/* Main input area */}
      <Box>
        {/* Prompt */}
        <Box marginRight={1}>
          <Text color={promptColor} bold>
            {prompt}
          </Text>
          <Text color={promptColor}>
            {ICONS.chevron}
          </Text>
        </Box>

        {/* Input area */}
        <Box flexGrow={1} minWidth={0}>
          {renderContent()}
        </Box>
      </Box>

      {/* Character count for long inputs */}
      {value.length > maxLength * 0.8 && (
        <Box marginLeft={2}>
          <Text color={value.length >= maxLength ? COLORS.error : COLORS.textMuted}>
            {value.length}/{maxLength}
          </Text>
        </Box>
      )}

      {/* Suggestions dropdown */}
      {showSuggestions && filteredSuggestions.length > 0 && (
        <Box
          flexDirection="column"
          marginTop={1}
          paddingLeft={prompt.length + 2}
        >
          <Box marginBottom={1}>
            <Text color={COLORS.textMuted} dimColor>
              Suggestions (Tab to complete):
            </Text>
          </Box>
          {filteredSuggestions.map((suggestion, index) => (
            <Box key={suggestion}>
              <Text
                color={index === selectedSuggestion ? COLORS.primary : COLORS.textMuted}
                backgroundColor={index === selectedSuggestion ? COLORS.borderLight : undefined}
              >
                {index === selectedSuggestion ? ICONS.focused : ' '} {suggestion}
              </Text>
            </Box>
          ))}
          <Box marginTop={1}>
            <Text color={COLORS.textVeryDim} dimColor>
              Use ↑↓ to navigate • Tab to complete • Esc to cancel
            </Text>
          </Box>
        </Box>
      )}

      {/* Helpful hints */}
      {!showSuggestions && !isLoading && (
        <Box marginTop={1} paddingLeft={prompt.length + 2}>
          <Text color={COLORS.textVeryDim} dimColor>
            Enter: send • Shift+Enter: new line • ←→: navigate • Ctrl+A/E: start/end • Ctrl+U: clear
          </Text>
        </Box>
      )}
    </Box>
  );
}

/**
 * Simplified input for backwards compatibility
 */
export function SimpleInput(props: Partial<EnhancedInputProps>) {
  return <EnhancedInput {...props} value={props.value || ''} onChange={props.onChange || (() => {})} onSubmit={props.onSubmit || (() => {})} />;
}