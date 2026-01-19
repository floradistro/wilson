/**
 * Centralized command definitions for Wilson CLI
 * Used by both --help and /help for consistency
 */

export interface CommandDef {
  name: string;
  aliases: string[];
  description: string;
  category: 'conversation' | 'navigation' | 'info' | 'session' | 'config' | 'swarm';
}

export const SLASH_COMMANDS: CommandDef[] = [
  // Conversation
  { name: 'new', aliases: ['clear'], description: 'Start fresh conversation', category: 'conversation' },

  // Navigation
  { name: 'stores', aliases: ['store'], description: 'Switch store', category: 'navigation' },
  { name: 'location', aliases: ['loc', 'locations'], description: 'Switch location', category: 'navigation' },
  { name: 'refresh', aliases: ['sync'], description: 'Sync stores from server', category: 'navigation' },

  // Info
  { name: 'context', aliases: ['ctx'], description: 'Show context window usage', category: 'info' },
  { name: 'tokens', aliases: [], description: 'Show token usage and cost', category: 'info' },
  { name: 'status', aliases: [], description: 'View connection status', category: 'info' },
  { name: 'help', aliases: ['?'], description: 'Show help', category: 'info' },

  // Config
  { name: 'config', aliases: ['settings'], description: 'View and edit settings', category: 'config' },
  { name: 'rules', aliases: ['memory'], description: 'View and edit rules', category: 'config' },

  // Session
  { name: 'logout', aliases: ['quit', 'exit'], description: 'Sign out', category: 'session' },

  // Swarm - Multi-agent orchestration
  { name: 'swarm', aliases: [], description: 'Start a multi-agent swarm', category: 'swarm' },
  { name: 'swarm status', aliases: [], description: 'View swarm progress', category: 'swarm' },
  { name: 'swarm stop', aliases: ['swarm kill'], description: 'Stop running swarm', category: 'swarm' },
];

export const KEYBOARD_SHORTCUTS = [
  { key: 'Ctrl+C', description: 'Exit' },
  { key: 'Ctrl+L', description: 'Clear chat' },
  { key: '?', description: 'Toggle help' },
  { key: 'Esc', description: 'Go back / Dismiss' },
];

export const CLI_COMMANDS = [
  { command: 'wilson', description: 'Start interactive mode' },
  { command: 'wilson "query"', description: 'Run a one-off query' },
  { command: 'wilson login', description: 'Login to your account' },
  { command: 'wilson logout', description: 'Clear authentication' },
  { command: 'wilson update', description: 'Update to latest version' },
  { command: 'wilson check-updates', description: 'Check for available updates' },
];

export const CLI_FLAGS = [
  { flag: '-h, --help', description: 'Show this help message' },
  { flag: '-v, --version', description: 'Show version' },
  { flag: '-V, --verbose', description: 'Enable verbose output' },
  { flag: '--dangerously-skip-permissions', description: 'Skip all permission prompts' },
];

/**
 * Get all slash commands (for compatibility with CommandMenu)
 */
export function getSlashCommandsList(): CommandDef[] {
  return SLASH_COMMANDS;
}

/**
 * Find similar commands using Levenshtein distance
 */
export function findSimilarCommands(input: string, maxSuggestions = 3): string[] {
  const cleanInput = input.replace(/^\//, '').toLowerCase();

  // Collect all command names and aliases
  const allNames: string[] = [];
  for (const cmd of SLASH_COMMANDS) {
    allNames.push(cmd.name);
    allNames.push(...cmd.aliases);
  }

  // Calculate similarity scores
  const scored = allNames.map(name => ({
    name,
    score: similarity(cleanInput, name.toLowerCase()),
  }));

  // Filter and sort by similarity
  return scored
    .filter(x => x.score > 0.3) // At least 30% similar
    .sort((a, b) => b.score - a.score)
    .slice(0, maxSuggestions)
    .map(x => x.name);
}

/**
 * Simple similarity score (0-1) using Levenshtein distance
 */
function similarity(a: string, b: string): number {
  if (a === b) return 1;
  if (a.length === 0 || b.length === 0) return 0;

  // If one starts with the other, high similarity
  if (a.startsWith(b) || b.startsWith(a)) {
    return 0.8;
  }

  const distance = levenshteinDistance(a, b);
  const maxLen = Math.max(a.length, b.length);
  return 1 - distance / maxLen;
}

/**
 * Calculate Levenshtein distance between two strings
 */
function levenshteinDistance(a: string, b: string): number {
  const matrix: number[][] = [];

  for (let i = 0; i <= b.length; i++) {
    matrix[i] = [i];
  }
  for (let j = 0; j <= a.length; j++) {
    matrix[0][j] = j;
  }

  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      if (b.charAt(i - 1) === a.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1, // substitution
          matrix[i][j - 1] + 1,     // insertion
          matrix[i - 1][j] + 1      // deletion
        );
      }
    }
  }

  return matrix[b.length][a.length];
}
