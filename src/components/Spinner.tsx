import { useState, useEffect, useRef } from 'react';
import { Box, Text } from 'ink';

const FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
const INTERVAL = 80;

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
      setFrame((prev) => (prev + 1) % FRAMES.length);
      if (showElapsed) {
        setElapsed((Date.now() - startTime.current) / 1000);
      }
    }, INTERVAL);

    return () => clearInterval(timer);
  }, [showElapsed]);

  return (
    <Box>
      <Text color="green">{FRAMES[frame]}</Text>
      {label && <Text dimColor> {label}</Text>}
      {showElapsed && <Text dimColor> {elapsed.toFixed(1)}s</Text>}
    </Box>
  );
}
