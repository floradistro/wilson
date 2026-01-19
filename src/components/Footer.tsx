import { useState, useEffect, useCallback, useRef, memo } from 'react';
import { Box, Text, useInput, useStdout } from 'ink';
import { CleanInput } from './CleanInput.js';
import type { UsageStats } from '../types.js';
import { CommandMenu, filterCommands } from './CommandMenu.js';
import { COLORS } from '../theme/colors.js';
import { KNIGHT_RIDER_FRAMES, KNIGHT_RIDER_INTERVAL } from '../theme/ui.js';

const MAX_CTX = 200000;

// Knight Rider style streaming indicator
function StreamingIndicator({
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

  // Simple text-based spinner
  const spinChars = ['-', '\\', '|', '/'];
  const spin = spinChars[frame % spinChars.length];

  return (
    <Box>
      <Text color={COLORS.primary}>[{spin}]</Text>
      <Text color={COLORS.textMuted}> Generating</Text>
      <Text color={COLORS.textVeryDim}> - </Text>
      <Text color={COLORS.textDim}>{tokensStr} tokens</Text>
      <Text color={COLORS.textVeryDim}> - </Text>
      <Text color={COLORS.textDim}>{timeStr}</Text>
    </Box>
  );
}

// Idle stats - minimal single line
function IdleStats({
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
}

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

  const inputLen = inputValue.length;

  // Menu navigation handlers
  const handleMenuNavigate = useCallback((delta: number) => {
    setMenuIndex(prev => {
      const newIndex = prev + delta;
      return Math.max(0, Math.min(filteredCommands.length - 1, newIndex));
    });
  }, [filteredCommands.length]);

  const handleMenuSelect = useCallback(() => {
    if (filteredCommands[menuIndex]) {
      onInputChange('/' + filteredCommands[menuIndex].name);
    }
  }, [filteredCommands, menuIndex, onInputChange]);

  const handleMenuCancel = useCallback(() => {
    onInputChange('');
  }, [onInputChange]);

  // Handle appending text with functional update (avoids stale closure during paste)
  const handleAppendText = useCallback((text: string) => {
    onInputChange(prev => prev + text);
  }, [onInputChange]);

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
        <Box>
          <Text color={disabled ? COLORS.textDisabled : COLORS.primary} bold>
            ›{' '}
          </Text>
          <Box flexGrow={1}>
            <CleanInput
              value={inputValue}
              onChange={onInputChange}
              onAppendText={handleAppendText}
              onSubmit={onSubmit}
              placeholder={placeholder}
              disabled={disabled}
              menuVisible={showMenu}
              menuItemCount={filteredCommands.length}
              menuSelectedIndex={menuIndex}
              onMenuNavigate={handleMenuNavigate}
              onMenuSelect={handleMenuSelect}
              onMenuCancel={handleMenuCancel}
            />
          </Box>
        </Box>
      </Box>
    </Box>
  );
});
