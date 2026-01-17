import { resolve } from 'path';

// =============================================================================
// Dangerous Command Patterns - Ported from lisa.js
// =============================================================================

interface DangerPattern {
  pattern: RegExp;
  description: string;
}

export const DANGEROUS_PATTERNS: DangerPattern[] = [
  // Destructive file operations
  { pattern: /\brm\s+(-rf?|--force|-r)\s/i, description: 'recursive/forced delete' },
  { pattern: /\brm\s+.*\*/i, description: 'wildcard delete' },
  { pattern: /\brm\s+-[^r]*r/i, description: 'recursive delete' },

  // Database operations
  { pattern: /\bDROP\s+(TABLE|DATABASE|INDEX|VIEW)/i, description: 'DROP statement' },
  { pattern: /\bTRUNCATE\s+TABLE/i, description: 'TRUNCATE statement' },
  { pattern: /\bDELETE\s+FROM\s+\w+\s*(;|$)/i, description: 'DELETE without WHERE' },

  // Git operations
  { pattern: /\bgit\s+push\s+.*--force/i, description: 'force push' },
  { pattern: /\bgit\s+push\s+-f\b/i, description: 'force push' },
  { pattern: /\bgit\s+reset\s+--hard/i, description: 'hard reset' },
  { pattern: /\bgit\s+clean\s+-fd/i, description: 'force clean' },

  // System operations
  { pattern: /\bsudo\s/i, description: 'sudo command' },
  { pattern: /\bchmod\s+777/i, description: 'chmod 777' },
  { pattern: /\bchown\s+-R\s+.*\/$/i, description: 'recursive chown on root' },

  // Dangerous writes
  { pattern: />\s*\/dev\/sd[a-z]/i, description: 'write to disk device' },
  { pattern: /\bdd\s+.*of=/i, description: 'dd write operation' },
  { pattern: /\bmkfs\b/i, description: 'filesystem format' },

  // Network/security
  { pattern: /\bcurl\s+.*\|\s*(ba)?sh/i, description: 'pipe curl to shell' },
  { pattern: /\bwget\s+.*\|\s*(ba)?sh/i, description: 'pipe wget to shell' },
];

/**
 * Check if a command matches any dangerous patterns
 * @returns The description of the danger if found, or null if safe
 */
export function checkDangerousCommand(command: string): string | null {
  for (const { pattern, description } of DANGEROUS_PATTERNS) {
    if (pattern.test(command)) {
      return description;
    }
  }
  return null;
}

/**
 * Sanitize a string for safe use in shell commands
 */
export function sanitizeForShell(str: string): string {
  return str.replace(/[`$();&|<>\\'"]/g, '');
}

/**
 * Check if a path is trying to escape the working directory
 */
export function isPathEscape(basePath: string, targetPath: string): boolean {
  const normalizedBase = basePath.replace(/\/$/, '');

  // Check for path traversal
  if (targetPath.includes('..')) {
    // Resolve the path and check if it's still under base
    const resolved = resolve(basePath, targetPath);
    return !resolved.startsWith(normalizedBase);
  }

  return false;
}
