import { useEffect } from 'react';
import { useStdin } from 'ink';

/**
 * Intercepts bracketed paste using Ink's useStdin hook.
 * This cooperates with Ink instead of competing with it.
 *
 * Architecture:
 * 1. Use Ink's useStdin() to listen alongside Ink's input processing
 * 2. Detect bracketed paste markers
 * 3. Call onPaste with the content
 * 4. Ink continues handling normal input
 */
export function usePasteInterceptor(
  onPaste: (text: string) => void,
  enabled: boolean = true
) {
  const { stdin, setRawMode, isRawModeSupported } = useStdin();

  useEffect(() => {
    if (!enabled || !stdin || !isRawModeSupported) {
      return;
    }

    let pasteBuffer = '';
    let isPasting = false;

    // Enable raw mode so we can see escape sequences
    setRawMode(true);

    // Enable bracketed paste mode
    if (process.stdout.isTTY) {
      process.stdout.write('\x1b[?2004h');
    }

    const handleStdin = (chunk: Buffer) => {
      const data = chunk.toString();

      // Debug logging
      if (process.env.DEBUG_PASTE === 'true') {
        console.error('[STDIN]', {
          len: data.length,
          has200: data.includes('\x1b[200~'),
          has201: data.includes('\x1b[201~'),
          isPasting,
          bufferLen: pasteBuffer.length,
          preview: data.substring(0, 50),
        });
      }

      // Start of paste
      if (data.includes('\x1b[200~')) {
        isPasting = true;
        const afterMarker = data.split('\x1b[200~')[1] || '';
        pasteBuffer = afterMarker;
        if (process.env.DEBUG_PASTE === 'true') {
          console.error('[PASTE START] buffer:', pasteBuffer.length, 'chars');
        }
        return;
      }

      // End of paste
      if (data.includes('\x1b[201~')) {
        if (isPasting) {
          const beforeMarker = data.split('\x1b[201~')[0] || '';
          pasteBuffer += beforeMarker;

          if (process.env.DEBUG_PASTE === 'true') {
            console.error('[PASTE END] total:', pasteBuffer.length, 'chars, lines:', pasteBuffer.split('\n').length);
          }

          // Send the paste (DON'T trim - preserves newlines and whitespace)
          if (pasteBuffer) {
            onPaste(pasteBuffer);
          }

          // Reset
          isPasting = false;
          pasteBuffer = '';
        }
        return;
      }

      // Accumulate paste content
      if (isPasting) {
        pasteBuffer += data;
        if (process.env.DEBUG_PASTE === 'true') {
          console.error('[ACCUMULATE] buffer now:', pasteBuffer.length, 'chars');
        }
      }
    };

    // Listen to stdin through Ink
    stdin.on('data', handleStdin);

    return () => {
      stdin.off('data', handleStdin);

      // Restore raw mode
      setRawMode(false);

      // Disable bracketed paste mode
      if (process.stdout.isTTY) {
        process.stdout.write('\x1b[?2004l');
      }
    };
  }, [onPaste, enabled, stdin, setRawMode, isRawModeSupported]);
}
