/**
 * Hierarchical Configuration Loader
 * Follows Anthropic's Claude Code pattern:
 *
 * Precedence (highest to lowest):
 * 1. CLI flags (runtime)
 * 2. Local settings (.wilson/settings.local.json) - machine-specific, gitignored
 * 3. Project settings (.wilson/settings.json) - team-shared
 * 4. User settings (~/.wilson/settings.json) - personal global
 * 5. Default settings (built-in)
 */

import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { AGENTIC_WORKFLOW_INSTRUCTIONS, STYLE_INSTRUCTIONS } from '../config/system-prompts.js';

// =============================================================================
// Types
// =============================================================================

export interface FormattingConfig {
  style: 'terminal' | 'markdown' | 'plain';
  maxLines: number;
  maxBulletPoints: number;
  avoidPatterns: string[];
  preferTables: boolean;
  statusFirst: boolean;
}

export interface PermissionsConfig {
  allow: string[];
  ask: string[];
  deny: string[];
}

export interface HookConfig {
  matcher?: string;
  command: string;
}

export interface HooksConfig {
  PreToolUse: HookConfig[];
  PostToolUse: HookConfig[];
  PreResponse: HookConfig[];
}

export interface ContextConfig {
  maxTokens: number;
  compactionThreshold: number;
  preserveRecentTurns: number;
}

export interface WilsonSettings {
  version: string;
  formatting: FormattingConfig;
  permissions: PermissionsConfig;
  hooks: HooksConfig;
  context: ContextConfig;
}

// =============================================================================
// Defaults
// =============================================================================

const DEFAULT_SETTINGS: WilsonSettings = {
  version: '1.0.0',
  formatting: {
    style: 'terminal',
    maxLines: 15,
    maxBulletPoints: 5,
    avoidPatterns: ['**', '###', 'emoji'],
    preferTables: true,
    statusFirst: true,
  },
  permissions: {
    allow: ['read_*', 'search_*', 'list_*'],
    ask: ['write_*', 'create_*', 'update_*'],
    deny: ['delete_*', 'drop_*'],
  },
  hooks: {
    PreToolUse: [],
    PostToolUse: [],
    PreResponse: [],
  },
  context: {
    maxTokens: 180000,
    compactionThreshold: 150000,
    preserveRecentTurns: 10,
  },
};

// =============================================================================
// Config Loading
// =============================================================================

let cachedSettings: WilsonSettings | null = null;
let cachedMemory: string | null = null;

/**
 * Deep merge two objects, with source overriding target
 */
function deepMerge<T extends Record<string, unknown>>(target: T, source: Partial<T>): T {
  const result = { ...target };

  for (const key of Object.keys(source) as (keyof T)[]) {
    const sourceValue = source[key];
    const targetValue = target[key];

    if (
      sourceValue !== undefined &&
      typeof sourceValue === 'object' &&
      sourceValue !== null &&
      !Array.isArray(sourceValue) &&
      typeof targetValue === 'object' &&
      targetValue !== null &&
      !Array.isArray(targetValue)
    ) {
      result[key] = deepMerge(
        targetValue as Record<string, unknown>,
        sourceValue as Record<string, unknown>
      ) as T[keyof T];
    } else if (sourceValue !== undefined) {
      result[key] = sourceValue as T[keyof T];
    }
  }

  return result;
}

/**
 * Try to read and parse a JSON settings file
 */
function tryReadSettings(filePath: string): Partial<WilsonSettings> | null {
  try {
    if (existsSync(filePath)) {
      const content = readFileSync(filePath, 'utf-8');
      return JSON.parse(content);
    }
  } catch {
    // Invalid JSON or read error - skip this file
  }
  return null;
}

/**
 * Load settings with hierarchical precedence
 */
export function loadSettings(cliOverrides?: Partial<WilsonSettings>): WilsonSettings {
  if (cachedSettings && !cliOverrides) {
    return cachedSettings;
  }

  const cwd = process.cwd();
  const home = homedir();

  // Layer 5: Start with defaults
  let settings = { ...DEFAULT_SETTINGS };

  // Layer 4: User global settings (~/.wilson/settings.json)
  const userSettings = tryReadSettings(join(home, '.wilson', 'settings.json'));
  if (userSettings) {
    settings = deepMerge(settings, userSettings);
  }

  // Layer 3: Project settings (.wilson/settings.json)
  const projectSettings = tryReadSettings(join(cwd, '.wilson', 'settings.json'));
  if (projectSettings) {
    settings = deepMerge(settings, projectSettings);
  }

  // Layer 2: Local settings (.wilson/settings.local.json) - gitignored
  const localSettings = tryReadSettings(join(cwd, '.wilson', 'settings.local.json'));
  if (localSettings) {
    settings = deepMerge(settings, localSettings);
  }

  // Layer 1: CLI overrides (runtime)
  if (cliOverrides) {
    settings = deepMerge(settings, cliOverrides);
  }

  cachedSettings = settings;
  return settings;
}

/**
 * Clear cached settings (useful for testing or hot-reload)
 */
export function clearSettingsCache(): void {
  cachedSettings = null;
  cachedMemory = null;
}

// =============================================================================
// Memory Loading (WILSON.md files)
// =============================================================================

/**
 * Load memory files with hierarchical precedence
 *
 * Order (all get concatenated):
 * 1. User memory (~/.wilson/WILSON.md) - personal global
 * 2. Project memory (./WILSON.md or ./.wilson/WILSON.md) - team shared
 * 3. Local memory (./WILSON.local.md) - personal per-project, gitignored
 */
export function loadMemory(): string {
  if (cachedMemory !== null) {
    return cachedMemory;
  }

  const cwd = process.cwd();
  const home = homedir();
  const memoryParts: string[] = [];

  // Helper to read memory file
  const tryReadMemory = (filePath: string, label: string): void => {
    try {
      if (existsSync(filePath)) {
        const content = readFileSync(filePath, 'utf-8').trim();
        if (content) {
          memoryParts.push(`# ${label}\n${content}`);
        }
      }
    } catch {
      // Skip unreadable files
    }
  };

  // Layer 1: User global memory
  tryReadMemory(join(home, '.wilson', 'WILSON.md'), 'User Instructions');

  // Layer 2: Project memory (check both locations)
  const projectMemoryPaths = [
    join(cwd, 'WILSON.md'),
    join(cwd, '.wilson', 'WILSON.md'),
  ];
  for (const path of projectMemoryPaths) {
    if (existsSync(path)) {
      tryReadMemory(path, 'Project Instructions');
      break; // Only use first found
    }
  }

  // Layer 3: Local memory (gitignored)
  tryReadMemory(join(cwd, 'WILSON.local.md'), 'Local Instructions');

  cachedMemory = memoryParts.join('\n\n---\n\n');
  return cachedMemory;
}

// =============================================================================
// System Prompt Builder
// =============================================================================

/**
 * Build the complete system prompt from settings and memory
 * This is what gets sent to Claude - rules are injected HERE, not post-processed
 */
export function buildSystemPrompt(settings?: WilsonSettings): string {
  const config = settings || loadSettings();
  const memory = loadMemory();

  // Build complete system prompt from centralized components
  const parts = [
    STYLE_INSTRUCTIONS,
    AGENTIC_WORKFLOW_INSTRUCTIONS,
  ];

  // Add project memory (WILSON.md, etc.) if available
  if (memory) {
    parts.push(memory);
  }

  // Add formatting preferences
  const formattingRules = `
## Response Formatting Preferences
- Style: ${config.formatting.style}
- Max lines per section: ${config.formatting.maxLines}
- Max bullet points: ${config.formatting.maxBulletPoints}
- Avoid patterns: ${config.formatting.avoidPatterns.join(', ')}
- Prefer tables: ${config.formatting.preferTables}
- Status first: ${config.formatting.statusFirst}
`.trim();
  parts.push(formattingRules);

  return parts.join('\n\n');
}

// =============================================================================
// Permission Checking
// =============================================================================

/**
 * Check if a tool is allowed, needs asking, or is denied
 */
export function checkPermission(
  toolName: string,
  settings?: WilsonSettings
): 'allow' | 'ask' | 'deny' {
  const config = settings || loadSettings();
  const { allow, ask, deny } = config.permissions;

  // Helper to match patterns (supports * wildcard)
  const matches = (pattern: string, name: string): boolean => {
    if (pattern === '*') return true;
    if (pattern.endsWith('*')) {
      return name.startsWith(pattern.slice(0, -1));
    }
    if (pattern.startsWith('*')) {
      return name.endsWith(pattern.slice(1));
    }
    return pattern === name;
  };

  // Check deny first (highest precedence)
  for (const pattern of deny) {
    if (matches(pattern, toolName)) {
      return 'deny';
    }
  }

  // Check ask next
  for (const pattern of ask) {
    if (matches(pattern, toolName)) {
      return 'ask';
    }
  }

  // Check allow
  for (const pattern of allow) {
    if (matches(pattern, toolName)) {
      return 'allow';
    }
  }

  // Default: ask
  return 'ask';
}
