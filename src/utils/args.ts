import type { Flags } from '../types.js';
import { config } from '../config.js';
import { SLASH_COMMANDS, CLI_COMMANDS, CLI_FLAGS, KEYBOARD_SHORTCUTS } from '../help/commands.js';
import { COLORS } from '../theme/colors.js';

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
    } else if (arg === '--worker' && argv[i + 1]) {
      flags.worker = argv[++i];
    } else if (arg === '--validator') {
      flags.validator = true;
    } else if (arg === '--swarm-monitor' && argv[i + 1]) {
      flags.swarmMonitor = argv[++i];
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
  const green = '\x1b[32m';
  const dim = '\x1b[2m';
  const bold = '\x1b[1m';
  const reset = '\x1b[0m';

  console.log(`
${green}${bold}wilson${reset} ${dim}v${config.version}${reset} - AI-powered CLI assistant

${bold}Usage:${reset}`);

  // CLI Commands
  for (const cmd of CLI_COMMANDS) {
    console.log(`  ${cmd.command.padEnd(24)} ${dim}${cmd.description}${reset}`);
  }

  console.log(`
${bold}Options:${reset}`);
  for (const flag of CLI_FLAGS) {
    console.log(`  ${flag.flag.padEnd(32)} ${dim}${flag.description}${reset}`);
  }

  console.log(`
${bold}Slash Commands:${reset} ${dim}(in interactive mode)${reset}`);
  for (const cmd of SLASH_COMMANDS) {
    const aliases = cmd.aliases.length > 0 ? ` ${dim}(${cmd.aliases.join(', ')})${reset}` : '';
    console.log(`  ${green}/${cmd.name.padEnd(12)}${reset}${aliases.padEnd(20)} ${dim}${cmd.description}${reset}`);
  }

  console.log(`
${bold}Keyboard Shortcuts:${reset}`);
  for (const shortcut of KEYBOARD_SHORTCUTS) {
    console.log(`  ${shortcut.key.padEnd(10)} ${dim}${shortcut.description}${reset}`);
  }

  console.log(`
${bold}Examples:${reset}
  wilson "list files in src"
  wilson "create a new React component"
  wilson
`);
}

export function printVersion(): void {
  console.log(`wilson v${config.version}`);
}
