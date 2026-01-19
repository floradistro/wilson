import React, { useState, useEffect, useRef } from 'react';
import { Box, Text, useInput } from 'ink';
import chalk from 'chalk';
import { COLORS } from '../theme/colors.js';
import { ICONS, SPACING } from '../theme/ui.js';
import { DESIGN_SYSTEM } from '../theme/design-system.js';

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
  const inputRef = useRef<string>(value);

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
    
    // Handle special keys
    if (key.return) {
      if (showSuggestions && filteredSuggestions[selectedSuggestion]) {
        onChange(filteredSuggestions[selectedSuggestion]);
        setShowSuggestions(false);
      } else {
        onSubmit(value);
      }
      return;
    }

    if (key.escape) {
      setShowSuggestions(false);
      return;
    }

    if (key.tab && filteredSuggestions.length > 0) {
      onChange(filteredSuggestions[selectedSuggestion] || filteredSuggestions[0]);
      setShowSuggestions(false);
      return;
    }

    if (key.upArrow && showSuggestions) {
      setSelectedSuggestion(Math.max(0, selectedSuggestion - 1));
      return;
    }

    if (key.downArrow && showSuggestions) {
      setSelectedSuggestion(Math.min(filteredSuggestions.length - 1, selectedSuggestion + 1));
      return;
    }

    // Handle text input
    if (key.backspace || key.delete) {
      const newValue = value.slice(0, -1);
      onChange(newValue);
      setShowSuggestions(newValue.length > 2 && filteredSuggestions.length > 0);
    } else if (input && value.length < maxLength) {
      const newValue = value + input;
      onChange(newValue);
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

  const cursor = cursorVisible && isFocused && !isLoading ? '▊' : '';
  const displayValue = value || '';
  const showPlaceholder = displayValue.length === 0 && !isLoading;

  return (
    <Box flexDirection="column">
      {/* Main input row */}
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
          {isLoading ? (
            <Box>
              <Text color={COLORS.textMuted}>
                {ICONS.spinner.frames[0]} Processing...
              </Text>
            </Box>
          ) : showPlaceholder ? (
            <Text color={COLORS.textDim}>
              {placeholder}
            </Text>
          ) : (
            <Box>
              <Text color={inputColor}>
                {displayValue}
              </Text>
              <Text color={COLORS.primary}>
                {cursor}
              </Text>
            </Box>
          )}
        </Box>

        {/* Character count for long inputs */}
        {value.length > maxLength * 0.8 && (
          <Box marginLeft={2}>
            <Text color={value.length >= maxLength ? COLORS.error : COLORS.textMuted}>
              {value.length}/{maxLength}
            </Text>
          </Box>
        )}
      </Box>

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
            Press Enter to send • /help for commands • Ctrl+C to exit
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