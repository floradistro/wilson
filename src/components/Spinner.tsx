import { useState, useEffect, useRef } from 'react';
import { Box, Text } from 'ink';
import { COLORS } from '../theme/colors.js';

// Knight Rider style animation - bouncing dot
const KNIGHT_RIDER_FRAMES = ['●∘∘∘∘', '∘●∘∘∘', '∘∘●∘∘', '∘∘∘●∘', '∘∘∘∘●', '∘∘∘●∘', '∘∘●∘∘', '∘●∘∘∘'];
const INTERVAL = 120;

interface SpinnerProps {
  label?: string;
  showElapsed?: boolean;
}

export function Spinner({ label, showElapsed = false }: SpinnerProps) {
  const [frame, setFrame] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const startTime = useRef(Date.now());

  useEffect(() => {
    const timer = setInterval(() => {
      setFrame((prev) => (prev + 1) % KNIGHT_RIDER_FRAMES.length);
      if (showElapsed) {
        setElapsed((Date.now() - startTime.current) / 1000);
      }
    }, INTERVAL);

    return () => clearInterval(timer);
  }, [showElapsed]);

  // Render knight rider with color gradient
  const currentFrame = KNIGHT_RIDER_FRAMES[frame];

  return (
    <Box>
      <Text>
        {currentFrame.split('').map((char, i) => (
          <Text key={i} color={char === '●' ? COLORS.primary : COLORS.textDisabled}>{char}</Text>
        ))}
      </Text>
      {label && <Text color={COLORS.textMuted}> {label}</Text>}
      {showElapsed && <Text color={COLORS.textDim}> {elapsed.toFixed(1)}s</Text>}
    </Box>
  );
}
