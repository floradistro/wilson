import { useState, useEffect, useCallback } from 'react';

export interface TerminalSize {
  width: number;
  height: number;
  // Computed responsive values
  codeBlockWidth: number;
  maxContentWidth: number;
  isNarrow: boolean;
  isVeryNarrow: boolean;
}

const MIN_WIDTH = 60;
const NARROW_THRESHOLD = 80;
const VERY_NARROW_THRESHOLD = 65;

/**
 * Hook to track terminal size changes reactively
 * Uses process.stdout directly and forces re-render on resize
 */
export function useTerminalSize(): TerminalSize {
  const getSize = useCallback((): TerminalSize => {
    const width = process.stdout.columns || 80;
    const height = process.stdout.rows || 24;

    // Compute responsive values
    const isVeryNarrow = width < VERY_NARROW_THRESHOLD;
    const isNarrow = width < NARROW_THRESHOLD;

    // Code block width: leave margin for borders and indentation
    // At minimum, 40 chars for code content
    const codeBlockWidth = Math.max(40, Math.min(width - 8, 100));

    // Max content width for text wrapping
    const maxContentWidth = Math.max(40, width - 6);

    return {
      width,
      height,
      codeBlockWidth,
      maxContentWidth,
      isNarrow,
      isVeryNarrow,
    };
  }, []);

  const [size, setSize] = useState<TerminalSize>(getSize);

  useEffect(() => {
    const handleResize = () => {
      // Force immediate re-render with new size
      setSize(getSize());
    };

    // Initial size
    handleResize();

    // Listen for terminal resize events
    process.stdout.on('resize', handleResize);

    return () => {
      process.stdout.off('resize', handleResize);
    };
  }, [getSize]);

  return size;
}

/**
 * Get responsive box width based on terminal size
 * Returns a width that fits within the terminal with margins
 */
export function getResponsiveWidth(termWidth: number, minWidth = 40, maxWidth = 100): number {
  const available = termWidth - 8; // Leave margin for borders/indent
  return Math.max(minWidth, Math.min(available, maxWidth));
}

/**
 * Truncate a line to fit within a given width
 * Handles ANSI escape codes properly
 */
export function truncateLine(line: string, maxWidth: number): string {
  // Strip ANSI codes for length calculation
  const stripped = line.replace(/\x1b\[[0-9;]*m/g, '');

  if (stripped.length <= maxWidth) {
    return line;
  }

  // Need to truncate - this is tricky with ANSI codes
  // Simple approach: find where to cut in the stripped version
  // and apply to original
  let visibleChars = 0;
  let cutIndex = 0;

  for (let i = 0; i < line.length; i++) {
    // Skip ANSI sequences
    if (line[i] === '\x1b') {
      const match = line.slice(i).match(/^\x1b\[[0-9;]*m/);
      if (match) {
        cutIndex = i + match[0].length;
        i += match[0].length - 1;
        continue;
      }
    }

    visibleChars++;
    cutIndex = i + 1;

    if (visibleChars >= maxWidth - 1) {
      break;
    }
  }

  return line.slice(0, cutIndex) + '…';
}

/**
 * Check if terminal is too small
 */
export function isTerminalTooSmall(width: number, height: number): boolean {
  return width < MIN_WIDTH || height < 8;
}
