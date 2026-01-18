import { useState, useEffect, useCallback, useRef, memo } from 'react';
import { Box, Text, useInput, useStdout } from 'ink';
import type { UsageStats } from '../types.js';
import { CommandMenu, filterCommands, COMMANDS } from './CommandMenu.js';

const MAX_CTX = 200000;

// Single pixel pulse animation
const PixelPulse = memo(function PixelPulse() {
  const [frame, setFrame] = useState(0);
  const frames = ['·', '•', '✦', '❋', '✦', '•'];

  useEffect(() => {
    const id = setInterval(() => setFrame(f => (f + 1) % frames.length), 150);
    return () => clearInterval(id);
  }, []);

  return <Text color="#7DC87D">{frames[frame]} </Text>;
});

// Mini Knight Rider animation for the input line
const KnightRider = memo(function KnightRider({ width = 12 }: { width?: number }) {
  const [pos, setPos] = useState(0);
  const dirRef = useRef(1);

  useEffect(() => {
    const id = setInterval(() => {
      setPos(p => {
        const next = p + dirRef.current;
        if (next >= width - 1) {
          dirRef.current = -1;
          return width - 1;
        }
        if (next <= 0) {
          dirRef.current = 1;
          return 0;
        }
        return next;
      });
    }, 60);
    return () => clearInterval(id);
  }, [width]);

  const bar = Array(width).fill(0).map((_, i) => {
    const dist = Math.abs(i - pos);
    if (dist === 0) return '█';
    if (dist === 1) return '▓';
    if (dist === 2) return '▒';
    return '░';
  }).join('');

  return <Text color="#7DC87D">{bar}</Text>;
});

// Separate stats line to isolate dots animation
const StatsLine = memo(function StatsLine({
  isStreaming, streamingChars, usage, toolCallCount, contextTokens
}: {
  isStreaming: boolean;
  streamingChars: number;
  usage: UsageStats;
  toolCallCount: number;
  contextTokens: number;
}) {
  const [dots, setDots] = useState(0);

  useEffect(() => {
    if (!isStreaming) { setDots(0); return; }
    const id = setInterval(() => setDots(d => (d + 1) % 4), 400);
    return () => clearInterval(id);
  }, [isStreaming]);

  const fmt = (n: number) => n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);
  const pct = Math.round((contextTokens / MAX_CTX) * 100);
  const hasStats = usage.inputTokens > 0 || toolCallCount > 0;
  const estTokens = Math.ceil(streamingChars / 4);

  if (isStreaming) {
    // Fixed-width dots animation - dim remaining dots instead of hiding them
    return (
      <Box>
        <PixelPulse />
        <Text color="#7DC87D">generating</Text>
        <Text color="#7DC87D">{'.'.repeat(dots)}</Text>
        <Text color="#333">{'.'.repeat(3 - dots)}</Text>
        <Text color="#888">{streamingChars > 0 ? ` ${fmt(streamingChars)} chars (~${fmt(estTokens)} tokens)` : ''}</Text>
      </Box>
    );
  }

  if (hasStats) {
    return (
      <Text color="#555">
        ctx:{pct}% tools:{toolCallCount} ↑{fmt(usage.inputTokens)} ↓{fmt(usage.outputTokens)}
      </Text>
    );
  }

  return <Text color="#333">ready</Text>;
});

interface FooterProps {
  inputValue: string;
  onInputChange: (v: string) => void;
  onSubmit: (v: string) => void;
  placeholder?: string;
  disabled?: boolean;
  usage: UsageStats;
  toolCallCount: number;
  contextTokens: number;
  streamingChars: number;
  isStreaming: boolean;
}

export const Footer = memo(function Footer({
  inputValue, onInputChange, onSubmit, placeholder = 'Message wilson...',
  disabled = false, usage, toolCallCount, contextTokens, streamingChars, isStreaming,
}: FooterProps) {
  const { stdout } = useStdout();
  const width = (stdout?.columns || 80) - 1;
  const [menuIndex, setMenuIndex] = useState(0);

  // Check if we should show command menu
  const showMenu = inputValue.startsWith('/') && !disabled;
  const query = showMenu ? inputValue.slice(1) : '';
  const filteredCommands = showMenu ? filterCommands(query) : [];

  // Reset menu index when query changes
  useEffect(() => {
    setMenuIndex(0);
  }, [query]);

  useInput(useCallback((input: string, key: {
    return?: boolean;
    backspace?: boolean;
    delete?: boolean;
    ctrl?: boolean;
    meta?: boolean;
    escape?: boolean;
    upArrow?: boolean;
    downArrow?: boolean;
    tab?: boolean;
  }) => {
    if (disabled) return;

    // Handle command menu navigation
    if (showMenu && filteredCommands.length > 0) {
      if (key.upArrow) {
        setMenuIndex(i => i > 0 ? i - 1 : filteredCommands.length - 1);
        return;
      }
      if (key.downArrow) {
        setMenuIndex(i => i < filteredCommands.length - 1 ? i + 1 : 0);
        return;
      }
      if (key.tab) {
        // Complete with selected command
        const cmd = filteredCommands[menuIndex];
        if (cmd) {
          onInputChange('/' + cmd.name);
        }
        return;
      }
      if (key.return) {
        // Submit the selected command
        const cmd = filteredCommands[menuIndex];
        if (cmd) {
          onSubmit('/' + cmd.name);
        }
        return;
      }
      if (key.escape) {
        // Clear input to dismiss menu
        onInputChange('');
        return;
      }
    }

    // Normal input handling
    if (key.return) { onSubmit(inputValue); return; }
    if (key.backspace || key.delete) { onInputChange(inputValue.slice(0, -1)); return; }
    if (key.ctrl || key.meta || key.escape) return;
    if (input) onInputChange(inputValue + input);
  }, [disabled, inputValue, onInputChange, onSubmit, showMenu, filteredCommands, menuIndex]));

  return (
    <Box flexDirection="column">
      {/* Stats line - above the divider */}
      <Box paddingX={1}>
        <StatsLine
          isStreaming={isStreaming}
          streamingChars={streamingChars}
          usage={usage}
          toolCallCount={toolCallCount}
          contextTokens={contextTokens}
        />
      </Box>

      {/* Command menu - above divider */}
      <CommandMenu
        query={query}
        selectedIndex={menuIndex}
        visible={showMenu}
      />

      {/* Divider line */}
      <Text color="#333">{'─'.repeat(width)}</Text>

      {/* Input prompt with Knight Rider animation when streaming */}
      <Box paddingX={1}>
        <Text color={disabled ? '#333' : '#555'}>❯ </Text>
        {inputValue ? (
          <Text color={disabled ? '#444' : '#E0E0E0'}>{inputValue}</Text>
        ) : (
          <Text color={disabled ? '#333' : '#444'}>{placeholder}</Text>
        )}
        <Text color={disabled ? '#333' : '#7DC87D'}>▋</Text>
        {isStreaming && (
          <>
            <Text> </Text>
            <KnightRider width={16} />
          </>
        )}
      </Box>
    </Box>
  );
});
