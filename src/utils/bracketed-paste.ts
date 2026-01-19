/**
 * Bracketed Paste Mode Support
 * Enables terminals to preserve newlines in pasted content
 */

// Enable bracketed paste mode
export function enableBracketedPaste() {
  if (process.stdin.isTTY) {
    process.stdout.write('\x1b[?2004h');
  }
}

// Disable bracketed paste mode (CRITICAL on exit)
export function disableBracketedPaste() {
  if (process.stdin.isTTY) {
    process.stdout.write('\x1b[?2004l');
  }
}

// Parse bracketed paste sequences
export function parseBracketedPaste(data: string): { isPaste: boolean; content: string } {
  // Check for paste start sequence
  const pasteStart = '\x1b[200~';
  const pasteEnd = '\x1b[201~';

  if (data.includes(pasteStart)) {
    // Extract content between paste markers
    const startIndex = data.indexOf(pasteStart) + pasteStart.length;
    const endIndex = data.indexOf(pasteEnd);

    if (endIndex > startIndex) {
      const content = data.substring(startIndex, endIndex);
      return { isPaste: true, content };
    }
  }

  return { isPaste: false, content: data };
}
