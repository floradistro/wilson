/**
 * Terminal capability detection and validation for Wilson CLI
 */

export interface TerminalCapabilities {
  width: number;
  height: number;
  supportsColor: boolean;
  supportsUnicode: boolean;
  isTTY: boolean;
}

const MIN_WIDTH = 60;
const MIN_HEIGHT = 10;

/**
 * Get current terminal capabilities
 */
export function getTerminalCapabilities(): TerminalCapabilities {
  const stdout = process.stdout;

  return {
    width: stdout.columns || 80,
    height: stdout.rows || 24,
    supportsColor: detectColorSupport(),
    supportsUnicode: process.platform !== 'win32' || process.env.WT_SESSION !== undefined,
    isTTY: stdout.isTTY || false,
  };
}

/**
 * Validate terminal meets minimum requirements
 * Returns null if OK, or error message if not
 */
export function validateTerminal(): string | null {
  const caps = getTerminalCapabilities();

  if (caps.width < MIN_WIDTH) {
    return `Terminal too narrow (${caps.width} cols, need ${MIN_WIDTH}+). Resize your terminal.`;
  }

  if (caps.height < MIN_HEIGHT) {
    return `Terminal too short (${caps.height} rows, need ${MIN_HEIGHT}+). Resize your terminal.`;
  }

  return null;
}

/**
 * Detect color support
 */
function detectColorSupport(): boolean {
  // Check for explicit NO_COLOR
  if (process.env.NO_COLOR === '1') {
    return false;
  }

  // Check for FORCE_COLOR
  if (process.env.FORCE_COLOR) {
    return true;
  }

  // Check if TTY
  if (!process.stdout.isTTY) {
    return false;
  }

  // Check TERM
  const term = process.env.TERM || '';
  if (term === 'dumb') {
    return false;
  }

  return true;
}

/**
 * Get safe terminal width (with fallback)
 */
export function getTerminalWidth(): number {
  return process.stdout.columns || 80;
}

/**
 * Truncate text to fit terminal width
 */
export function truncateToWidth(text: string, maxWidth?: number, suffix = '...'): string {
  const width = maxWidth || getTerminalWidth() - 4; // Leave some margin
  if (text.length <= width) {
    return text;
  }
  return text.slice(0, width - suffix.length) + suffix;
}
