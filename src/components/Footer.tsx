import { useState, useEffect, useCallback, useRef, memo } from 'react';
import { Box, Text, useInput, useStdout } from 'ink';
import type { UsageStats } from '../types.js';
import { CommandMenu, filterCommands } from './CommandMenu.js';
import { COLORS } from '../theme/colors.js';
import { KNIGHT_RIDER_FRAMES, KNIGHT_RIDER_INTERVAL } from '../theme/ui.js';

const MAX_CTX = 200000;

// Knight Rider style streaming indicator
const StreamingIndicator = memo(function StreamingIndicator({
  streamingChars, startTime
}: { streamingChars: number; startTime: number }) {
  const [frame, setFrame] = useState(0);
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    const id = setInterval(() => {
      setFrame(f => (f + 1) % KNIGHT_RIDER_FRAMES.length);
      setElapsed(Math.floor((Date.now() - startTime) / 1000));
    }, KNIGHT_RIDER_INTERVAL);
    return () => clearInterval(id);
  }, [startTime]);

  // Estimate tokens (~4 chars per token)
  const estTokens = Math.ceil(streamingChars / 4);
  const tokensStr = estTokens >= 1000 ? `${(estTokens / 1000).toFixed(1)}k` : String(estTokens);

  // Format time
  const mins = Math.floor(elapsed / 60);
  const secs = elapsed % 60;
  const timeStr = mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;

  // Render Knight Rider with color gradient
  const currentFrame = KNIGHT_RIDER_FRAMES[frame];

  return (
    <Box>
      <Text>
        {currentFrame.split('').map((char, i) => (
          <Text key={i} color={char === '●' ? COLORS.primary : COLORS.textDisabled}>{char}</Text>
        ))}
      </Text>
      <Text color={COLORS.textMuted}> Generating</Text>
      <Text color={COLORS.textVeryDim}> · </Text>
      <Text color={COLORS.textDim}>{tokensStr} tokens</Text>
      <Text color={COLORS.textVeryDim}> · </Text>
      <Text color={COLORS.textDim}>{timeStr}</Text>
    </Box>
  );
});

// Idle stats - minimal single line
const IdleStats = memo(function IdleStats({
  usage, toolCallCount, contextTokens
}: {
  usage: UsageStats;
  toolCallCount: number;
  contextTokens: number;
}) {
  const hasActivity = usage.inputTokens > 0 || toolCallCount > 0;

  if (!hasActivity) {
    return (
      <Box>
        <Text color={COLORS.textVeryDim}>Ready</Text>
      </Box>
    );
  }

  const pct = Math.round((contextTokens / MAX_CTX) * 100);
  const ctxColor = pct > 90 ? COLORS.error : pct > 75 ? COLORS.warning : COLORS.textDim;
  const total = usage.inputTokens + usage.outputTokens;
  const totalStr = total >= 1000 ? `${(total / 1000).toFixed(1)}k` : String(total);

  return (
    <Box>
      <Text color={ctxColor}>{pct}%</Text>
      <Text color={COLORS.textVeryDim}> ctx</Text>
      <Text color={COLORS.textDisabled}> · </Text>
      <Text color={COLORS.textDim}>{totalStr}</Text>
      <Text color={COLORS.textVeryDim}> tokens</Text>
      {toolCallCount > 0 && (
        <>
          <Text color={COLORS.textDisabled}> · </Text>
          <Text color={COLORS.textDim}>{toolCallCount}</Text>
          <Text color={COLORS.textVeryDim}> tools</Text>
        </>
      )}
    </Box>
  );
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
  const width = Math.max(40, (stdout?.columns || 80) - 1);
  const [menuIndex, setMenuIndex] = useState(0);
  const streamStartRef = useRef(Date.now());

  // Track streaming start time
  useEffect(() => {
    if (isStreaming) {
      streamStartRef.current = Date.now();
    }
  }, [isStreaming]);

  const showMenu = inputValue.startsWith('/') && !disabled;
  const query = showMenu ? inputValue.slice(1) : '';
  const filteredCommands = showMenu ? filterCommands(query) : [];

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
        const cmd = filteredCommands[menuIndex];
        if (cmd) onInputChange('/' + cmd.name);
        return;
      }
      if (key.return) {
        const cmd = filteredCommands[menuIndex];
        if (cmd) onSubmit('/' + cmd.name);
        return;
      }
      if (key.escape) {
        onInputChange('');
        return;
      }
    }

    if (key.return) { onSubmit(inputValue); return; }
    if (key.backspace || key.delete) { onInputChange(inputValue.slice(0, -1)); return; }
    if (key.ctrl || key.meta || key.escape) return;
    if (input) onInputChange(inputValue + input);
  }, [disabled, inputValue, onInputChange, onSubmit, showMenu, filteredCommands, menuIndex]));

  // Responsive input handling
  const promptWidth = 3;
  const availableWidth = Math.max(20, width - promptWidth - 5);
  const inputLen = inputValue.length;

  const displayValue = inputLen > availableWidth
    ? '…' + inputValue.slice(-(availableWidth - 1))
    : inputValue;

  return (
    <Box flexDirection="column">
      {/* Command menu - above divider */}
      {showMenu && (
        <CommandMenu
          query={query}
          selectedIndex={menuIndex}
          visible={showMenu}
        />
      )}

      {/* Thin divider */}
      <Text color={COLORS.textDisabled}>{'─'.repeat(width)}</Text>

      {/* Status line - minimal, Claude Code style */}
      <Box paddingX={1} justifyContent="space-between">
        <Box>
          {isStreaming ? (
            <StreamingIndicator
              streamingChars={streamingChars}
              startTime={streamStartRef.current}
            />
          ) : (
            <IdleStats
              usage={usage}
              toolCallCount={toolCallCount}
              contextTokens={contextTokens}
            />
          )}
        </Box>
        {/* Right side - just show char count when typing long input */}
        {inputLen > 200 && !isStreaming && (
          <Text color={inputLen > 500 ? COLORS.warning : COLORS.textVeryDim}>{inputLen}</Text>
        )}
      </Box>

      {/* Input area */}
      <Box paddingX={1}>
        <Text color={disabled ? COLORS.textDisabled : COLORS.primary}>› </Text>
        {inputValue ? (
          <Text color={disabled ? COLORS.textVeryDim : COLORS.text}>{displayValue}</Text>
        ) : (
          <Text color={COLORS.textVeryDim}>{placeholder}</Text>
        )}
        {!disabled && <Text color={COLORS.primary}>│</Text>}
      </Box>
    </Box>
  );
});
