import type { Flags } from '../types.js';
import { config } from '../config.js';

interface ParsedArgs {
  query?: string;
  flags: Flags;
}

export function parseArgs(argv: string[]): ParsedArgs {
  const flags: Flags = {};
  const positional: string[] = [];

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];

    if (arg === '--help' || arg === '-h') {
      flags.help = true;
    } else if (arg === '--version' || arg === '-v') {
      flags.version = true;
    } else if (arg === '--verbose' || arg === '-V') {
      flags.verbose = true;
    } else if (arg === '--dangerously-skip-permissions') {
      flags.dangerouslySkipPermissions = true;
    } else if (!arg.startsWith('-')) {
      // Skip known commands
      if (!['login', 'logout', 'version', 'update', 'check-updates'].includes(arg)) {
        positional.push(arg);
      }
    }
  }

  return {
    query: positional.join(' ') || undefined,
    flags,
  };
}

export function printHelp(): void {
  console.log(`
wilson v${config.version} - AI-powered CLI assistant

Usage:
  wilson [query]              Run a query
  wilson                      Start interactive mode
  wilson login                Login to your account
  wilson logout               Clear authentication
  wilson update               Update to latest version
  wilson check-updates        Check for available updates

Options:
  -h, --help                  Show this help message
  -v, --version               Show version
  -V, --verbose               Enable verbose output
  --dangerously-skip-permissions  Skip all permission prompts

Examples:
  wilson "list files in src"
  wilson "create a new React component"
  wilson

Keyboard Shortcuts (interactive mode):
  Ctrl+C   Exit
  Ctrl+L   Clear chat
  ?        Toggle help
  Esc      Dismiss errors
`);
}

export function printVersion(): void {
  console.log(`wilson v${config.version}`);
}
