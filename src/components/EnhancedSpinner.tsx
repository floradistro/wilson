import React, { useState, useEffect } from 'react';
import { Box, Text } from 'ink';
import { COLORS } from '../theme/colors.js';
import { ANIMATION, ICONS, SPACING } from '../theme/ui.js';

interface EnhancedSpinnerProps {
  type?: 'dots' | 'pulse' | 'progress' | 'fast';
  text?: string;
  subtext?: string;
  progress?: number; // 0-100 for progress spinner
  color?: string;
  size?: 'sm' | 'md' | 'lg';
  centered?: boolean;
}

export function EnhancedSpinner({
  type = 'dots',
  text = 'Loading',
  subtext,
  progress,
  color = COLORS.primary,
  size = 'md',
  centered = true,
}: EnhancedSpinnerProps) {
  const [frame, setFrame] = useState(0);

  const spinnerConfig = ANIMATION.spinners[type] || ANIMATION.spinners.dots;
  const frames = spinnerConfig.frames;
  const interval = spinnerConfig.interval;

  useEffect(() => {
    const timer = setInterval(() => {
      setFrame(current => (current + 1) % frames.length);
    }, interval);

    return () => clearInterval(timer);
  }, [frames.length, interval]);

  // Progress bar spinner
  if (type === 'progress' && progress !== undefined) {
    const barWidth = size === 'sm' ? 20 : size === 'lg' ? 40 : 30;
    const filledWidth = Math.round((progress / 100) * barWidth);
    const emptyWidth = barWidth - filledWidth;
    
    const progressBar = '●'.repeat(filledWidth) + '○'.repeat(emptyWidth);
    
    return (
      <Box 
        flexDirection="column" 
        alignItems={centered ? 'center' : 'flex-start'}
        justifyContent={centered ? 'center' : 'flex-start'}
      >
        <Box marginBottom={1}>
          <Text color={color}>
            {text}
          </Text>
        </Box>
        <Box marginBottom={1}>
          <Text color={color}>
            {progressBar}
          </Text>
          <Text color={COLORS.textMuted} marginLeft={1}>
            {Math.round(progress)}%
          </Text>
        </Box>
        {subtext && (
          <Text color={COLORS.textDim}>
            {subtext}
          </Text>
        )}
      </Box>
    );
  }

  // Regular spinner
  const spinnerSize = size === 'sm' ? 1 : size === 'lg' ? 3 : 2;
  const currentFrame = frames[frame];

  return (
    <Box 
      flexDirection="column" 
      alignItems={centered ? 'center' : 'flex-start'}
      justifyContent={centered ? 'center' : 'flex-start'}
    >
      <Box alignItems="center" marginBottom={subtext ? 1 : 0}>
        <Text color={color}>
          {currentFrame}
        </Text>
        <Text color={COLORS.text} marginLeft={2}>
          {text}
        </Text>
      </Box>
      {subtext && (
        <Text color={COLORS.textMuted}>
          {subtext}
        </Text>
      )}
    </Box>
  );
}

/**
 * Context-aware loading states
 */
export function LoadingState({ stage, progress }: {
  stage: 'initializing' | 'authenticating' | 'loading' | 'processing' | 'complete';
  progress?: number;
}) {
  const stageConfig = {
    initializing: { text: 'Initializing Wilson', type: 'pulse' as const },
    authenticating: { text: 'Authenticating', type: 'dots' as const },
    loading: { text: 'Loading data', type: 'fast' as const },
    processing: { text: 'Processing', type: 'dots' as const },
    complete: { text: 'Complete', type: 'dots' as const },
  };

  const config = stageConfig[stage];
  
  return (
    <EnhancedSpinner
      type={progress !== undefined ? 'progress' : config.type}
      text={config.text}
      progress={progress}
      color={stage === 'complete' ? COLORS.success : COLORS.primary}
    />
  );
}

/**
 * Inline spinner for small spaces
 */
export function InlineSpinner({ 
  color = COLORS.primary,
  type = 'fast' 
}: { 
  color?: string;
  type?: 'fast' | 'pulse';
}) {
  const [frame, setFrame] = useState(0);
  const spinnerConfig = ANIMATION.spinners[type];
  const frames = spinnerConfig.frames;
  const interval = spinnerConfig.interval;

  useEffect(() => {
    const timer = setInterval(() => {
      setFrame(current => (current + 1) % frames.length);
    }, interval);

    return () => clearInterval(timer);
  }, [frames.length, interval]);

  return (
    <Text color={color}>
      {frames[frame]}
    </Text>
  );
}

/**
 * Success state with checkmark animation
 */
export function SuccessSpinner({ 
  text = 'Complete',
  duration = 2000 
}: {
  text?: string;
  duration?: number;
}) {
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    const timer = setTimeout(() => {
      setVisible(false);
    }, duration);

    return () => clearTimeout(timer);
  }, [duration]);

  if (!visible) return null;

  return (
    <Box alignItems="center">
      <Text color={COLORS.success}>
        {ICONS.checkmark}
      </Text>
      <Text color={COLORS.text} marginLeft={2}>
        {text}
      </Text>
    </Box>
  );
}

/**
 * Error state with cross animation
 */
export function ErrorSpinner({ 
  text = 'Error',
  error,
}: {
  text?: string;
  error?: Error | string;
}) {
  const errorMessage = typeof error === 'string' ? error : error?.message;

  return (
    <Box flexDirection="column">
      <Box alignItems="center" marginBottom={errorMessage ? 1 : 0}>
        <Text color={COLORS.error}>
          {ICONS.cross}
        </Text>
        <Text color={COLORS.error} marginLeft={2}>
          {text}
        </Text>
      </Box>
      {errorMessage && (
        <Text color={COLORS.textMuted}>
          {errorMessage}
        </Text>
      )}
    </Box>
  );
}