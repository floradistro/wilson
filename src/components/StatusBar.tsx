import { useState, useEffect, useRef } from 'react';
import { Box, Text } from 'ink';
import type { UsageStats } from '../types.js';

const SPINNER_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
const MAX_CONTEXT_TOKENS = 200000;

interface StatusBarProps {
  usage: UsageStats;
  toolCallCount: number;
  isStreaming: boolean;
  contextTokens?: number;
}

export function StatusBar({ usage, toolCallCount, isStreaming, contextTokens = 0 }: StatusBarProps) {
  const [frame, setFrame] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const startTime = useRef(Date.now());

  useEffect(() => {
    if (!isStreaming) {
      setElapsed(0);
      return;
    }

    startTime.current = Date.now();

    const timer = setInterval(() => {
      setFrame((prev) => (prev + 1) % SPINNER_FRAMES.length);
      setElapsed((Date.now() - startTime.current) / 1000);
    }, 80);

    return () => clearInterval(timer);
  }, [isStreaming]);

  const formatTokens = (tokens: number): string => {
    if (tokens >= 1000000) return `${(tokens / 1000000).toFixed(1)}M`;
    if (tokens >= 1000) return `${(tokens / 1000).toFixed(1)}K`;
    return tokens.toString();
  };

  // Estimate cost (Claude pricing: ~$3/M input, ~$15/M output for Sonnet)
  const estimatedCost = (usage.inputTokens * 0.000003) + (usage.outputTokens * 0.000015);

  // Context usage percentage
  const contextPercentage = (contextTokens / MAX_CONTEXT_TOKENS) * 100;
  const contextColor = contextPercentage > 90 ? '#E07070' : contextPercentage > 75 ? '#FFCB6B' : '#7DC87D';

  // Progress bar for context
  const barWidth = 10;
  const filledBars = Math.round((contextPercentage / 100) * barWidth);
  const progressBar = '█'.repeat(filledBars) + '░'.repeat(barWidth - filledBars);

  return (
    <Box paddingX={1} marginTop={1}>
      {/* Status indicator - minimal, no duplicate "Working" */}
      <Box>
        <Text color={isStreaming ? '#7DC87D' : '#666666'}>
          {isStreaming ? SPINNER_FRAMES[frame] : '○'}
        </Text>
        <Text color="#666666">
          {' '}{isStreaming ? '' : 'Ready'}
        </Text>
      </Box>

      {/* Context usage with mini progress bar */}
      {contextTokens > 0 && (
        <Box marginLeft={2}>
          <Text color="#666666">Ctx </Text>
          <Text color={contextColor}>{progressBar}</Text>
          <Text color="#666666"> {contextPercentage.toFixed(0)}%</Text>
        </Box>
      )}

      {/* Tool calls */}
      <Box marginLeft={2}>
        <Text color="#666666">⚡</Text>
        <Text color="#B8B8B8">{toolCallCount}</Text>
      </Box>

      {/* Token usage */}
      <Box marginLeft={2}>
        <Text color="#666666">↑</Text>
        <Text color="#82AAFF">{formatTokens(usage.inputTokens)}</Text>
        <Text color="#666666"> ↓</Text>
        <Text color="#C792EA">{formatTokens(usage.outputTokens)}</Text>
      </Box>

      {/* Cost */}
      {estimatedCost > 0 && (
        <Box marginLeft={2}>
          <Text color="#666666">$</Text>
          <Text color="#7DC87D">{estimatedCost.toFixed(3)}</Text>
        </Box>
      )}
    </Box>
  );
}
