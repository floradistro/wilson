/**
 * Matrix-themed luxury intro animation
 * Full-width rain effect that reveals the Wilson logo
 */

import { useState, useEffect, useRef } from 'react';
import { Box, Text, useStdout } from 'ink';

interface MatrixIntroProps {
  onComplete: () => void;
}

// Half-width katakana for cleaner matrix look
const MATRIX_CHARS = 'ｦｱｲｳｴｵｶｷｸｹｺｻｼｽｾｿﾀﾁﾂﾃﾄﾅﾆﾇﾈﾉﾊﾋﾌﾍﾎﾏﾐﾑﾒﾓﾔﾕﾖﾗﾘﾙﾚﾛﾜﾝ01';

const GLOW = '#00ff41';
const GREEN = '#00dd33';
const MID = '#009922';
const DIM = '#004411';
const WHITE = '#ffffff';

// Elegant ASCII logo (centered) - full WILSON
const LOGO = [
  '╭────────────────────────────────────────────────────────────╮',
  '│                                                            │',
  '│  ██╗    ██╗ ██╗ ██╗      ███████╗  ██████╗  ███╗   ██╗     │',
  '│  ██║    ██║ ██║ ██║      ██╔════╝ ██╔═══██╗ ████╗  ██║     │',
  '│  ██║ █╗ ██║ ██║ ██║      ███████╗ ██║   ██║ ██╔██╗ ██║     │',
  '│  ██║███╗██║ ██║ ██║      ╚════██║ ██║   ██║ ██║╚██╗██║     │',
  '│  ╚███╔███╔╝ ██║ ███████╗ ███████║ ╚██████╔╝ ██║ ╚████║     │',
  '│   ╚══╝╚══╝  ╚═╝ ╚══════╝ ╚══════╝  ╚═════╝  ╚═╝  ╚═══╝     │',
  '│                                                            │',
  '╰────────────────────────────────────────────────────────────╯',
];

const LOGO_WIDTH = 62;
const HEIGHT = 16;
const DURATION = 2200;
const FRAME_RATE = 45;

function getRandomChar(): string {
  return MATRIX_CHARS[Math.floor(Math.random() * MATRIX_CHARS.length)];
}

interface Column {
  y: number;
  speed: number;
  length: number;
}

export function MatrixIntro({ onComplete }: MatrixIntroProps) {
  const { stdout } = useStdout();
  const termWidth = stdout?.columns || 80;

  const [frame, setFrame] = useState(0);
  const [phase, setPhase] = useState<'rain' | 'reveal' | 'hold'>('rain');
  const columnsRef = useRef<Column[]>(
    Array(termWidth).fill(0).map(() => ({
      y: Math.floor(Math.random() * -15),
      speed: 0.12 + Math.random() * 0.2,
      length: 5 + Math.floor(Math.random() * 8),
    }))
  );
  const completedRef = useRef(false);

  const totalFrames = DURATION / FRAME_RATE;
  const rainFrames = totalFrames * 0.45;
  const revealFrames = totalFrames * 0.35;

  useEffect(() => {
    const interval = setInterval(() => {
      if (phase === 'rain') {
        columnsRef.current.forEach(col => {
          col.y += col.speed;
          if (col.y > HEIGHT + col.length) {
            col.y = -col.length - Math.random() * 8;
            col.speed = 0.12 + Math.random() * 0.2;
          }
        });
      }

      setFrame(f => {
        const next = f + 1;
        if (next >= rainFrames && phase === 'rain') {
          setPhase('reveal');
        } else if (next >= rainFrames + revealFrames && phase === 'reveal') {
          setPhase('hold');
        }
        return next;
      });
    }, FRAME_RATE);

    return () => clearInterval(interval);
  }, [phase, rainFrames, revealFrames]);

  useEffect(() => {
    if (frame >= totalFrames && !completedRef.current) {
      completedRef.current = true;
      onComplete();
    }
  }, [frame, totalFrames, onComplete]);

  if (completedRef.current) {
    return null;
  }

  // Center padding for logo
  const logoPadding = Math.max(0, Math.floor((termWidth - LOGO_WIDTH) / 2));
  const padStr = ' '.repeat(logoPadding);

  // Reveal phase
  if (phase === 'reveal' || phase === 'hold') {
    const revealProgress = phase === 'hold' ? 1 : Math.min(1, (frame - rainFrames) / revealFrames);
    const linesRevealed = Math.floor(revealProgress * LOGO.length);

    return (
      <Box flexDirection="column">
        {/* Top rain remnants */}
        <Text color={DIM}>
          {Array(termWidth).fill(0).map(() => Math.random() > 0.85 ? getRandomChar() : ' ').join('')}
        </Text>

        {/* Logo with centering */}
        {LOGO.map((line, i) => {
          if (i > linesRevealed) {
            return (
              <Text key={i}>
                {padStr}
                <Text color={DIM}>
                  {line.split('').map(() => Math.random() > 0.6 ? getRandomChar() : ' ').join('')}
                </Text>
              </Text>
            );
          }

          const isEdge = i === 0 || i === LOGO.length - 1;
          const isLogoLine = i >= 2 && i <= 7;

          let color = MID;
          if (isEdge) color = DIM;
          else if (isLogoLine) color = phase === 'hold' ? GREEN : GLOW;

          return (
            <Text key={i}>
              {padStr}
              <Text color={color} bold={isLogoLine}>{line}</Text>
            </Text>
          );
        })}

        {/* Bottom rain remnants */}
        <Text color={DIM}>
          {Array(termWidth).fill(0).map(() => Math.random() > 0.9 ? getRandomChar() : ' ').join('')}
        </Text>
      </Box>
    );
  }

  // Rain phase - full width
  const columns = columnsRef.current;
  const grid: string[][] = Array(HEIGHT).fill(null).map(() => Array(termWidth).fill(' '));

  columns.forEach((col, x) => {
    const headY = Math.floor(col.y);
    for (let i = 0; i < col.length; i++) {
      const y = headY - i;
      if (y >= 0 && y < HEIGHT) {
        grid[y][x] = getRandomChar();
      }
    }
  });

  return (
    <Box flexDirection="column">
      {grid.map((row, y) => (
        <Text key={y}>
          {row.map((char, x) => {
            if (char === ' ') return <Text key={x}> </Text>;

            const col = columns[x];
            const headY = Math.floor(col.y);
            const dist = headY - y;

            const isHead = dist === 0;
            const color = isHead ? WHITE : dist === 1 ? GLOW : dist < 3 ? GREEN : dist < 5 ? MID : DIM;

            return <Text key={x} color={color}>{char}</Text>;
          })}
        </Text>
      ))}
    </Box>
  );
}
