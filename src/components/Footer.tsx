import { useState, useEffect, useCallback, memo } from 'react';
import { Box, Text, useInput, useStdout } from 'ink';
import type { UsageStats } from '../types.js';

const MAX_CTX = 200000;

interface FooterProps {
  inputValue: string;
  onInputChange: (v: string) => void;
  onSubmit: (v: string) => void;
  placeholder?: string;
  disabled?: boolean;
  usage: UsageStats;
  toolCallCount: number;
  contextTokens: number;
  isStreaming: boolean;
}

export const Footer = memo(function Footer({
  inputValue, onInputChange, onSubmit, placeholder = 'Message wilson...',
  disabled = false, usage, toolCallCount, contextTokens, isStreaming,
}: FooterProps) {
  const { stdout } = useStdout();
  const width = (stdout?.columns || 80) - 1; // Edge to edge
  const [pos, setPos] = useState(0);
  const [dir, setDir] = useState(1);

  useEffect(() => {
    if (!isStreaming) { setPos(0); return; }
    const id = setInterval(() => {
      setPos(p => {
        const next = p + dir * 2; // Move 2 positions per tick for speed
        if (next >= width - 1) { setDir(-1); return width - 1; }
        if (next <= 0) { setDir(1); return 0; }
        return next;
      });
    }, 16); // ~60fps
    return () => clearInterval(id);
  }, [isStreaming, dir, width]);

  useInput(useCallback((input: string, key: { return?: boolean; backspace?: boolean; delete?: boolean; ctrl?: boolean; meta?: boolean; escape?: boolean }) => {
    if (disabled) return;
    if (key.return) { onSubmit(inputValue); return; }
    if (key.backspace || key.delete) { onInputChange(inputValue.slice(0, -1)); return; }
    if (key.ctrl || key.meta || key.escape) return;
    if (input) onInputChange(inputValue + input);
  }, [disabled, inputValue, onInputChange, onSubmit]));

  const fmt = (n: number) => n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);
  const pct = Math.round((contextTokens / MAX_CTX) * 100);
  const hasStats = usage.inputTokens > 0 || toolCallCount > 0;

  // Knight Rider bar - full terminal width
  const bar = isStreaming
    ? Array(width).fill(0).map((_, i) => {
        const dist = Math.abs(i - pos);
        if (dist === 0) return '█';
        if (dist === 1) return '▓';
        if (dist === 2) return '▒';
        if (dist === 3) return '░';
        return '─';
      }).join('')
    : '─'.repeat(width);

  return (
    <Box flexDirection="column">
      {/* Full width animation bar */}
      <Text color={isStreaming ? '#7DC87D' : '#333'}>{bar}</Text>

      {/* Stats on separate line */}
      {hasStats && (
        <Box paddingX={1}>
          <Text color="#444">ctx:{pct}% tools:{toolCallCount} ↑{fmt(usage.inputTokens)} ↓{fmt(usage.outputTokens)}</Text>
        </Box>
      )}

      {/* Input prompt */}
      {!disabled && (
        <Box paddingX={1}>
          <Text color="#555">&gt; </Text>
          <Text color="#E0E0E0">{inputValue || <Text color="#444">{placeholder}</Text>}</Text>
          <Text color="#7DC87D">▌</Text>
        </Box>
      )}
    </Box>
  );
});
