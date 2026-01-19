/**
 * Wilson Hooks System
 *
 * Implements Anthropic-style pre/post tool execution hooks for:
 * - Pre-validation (read-before-write, parameter checks)
 * - Post-execution (error recovery, automatic retries)
 * - Self-correction loops
 *
 * Based on Claude Code's hook architecture
 */

import type { ToolResult } from '../../types.js';

// =============================================================================
// Types
// =============================================================================

export interface HookContext {
  toolName: string;
  params: Record<string, unknown>;
  workingDirectory: string;
  conversationId?: string;
  previousResults?: ToolResult[];
  retryCount?: number;
}

export interface PreHookResult {
  proceed: boolean;
  modifiedParams?: Record<string, unknown>;
  error?: string;
  suggestion?: string;
}

export interface PostHookResult {
  result: ToolResult;
  shouldRetry?: boolean;
  retryParams?: Record<string, unknown>;
  followUpAction?: FollowUpAction;
}

export interface FollowUpAction {
  toolName: string;
  params: Record<string, unknown>;
  reason: string;
}

export type PreHook = (context: HookContext) => Promise<PreHookResult>;
export type PostHook = (context: HookContext, result: ToolResult) => Promise<PostHookResult>;

// =============================================================================
// Hook Registry
// =============================================================================

const preHooks: Map<string, PreHook[]> = new Map();
const postHooks: Map<string, PostHook[]> = new Map();
const globalPreHooks: PreHook[] = [];
const globalPostHooks: PostHook[] = [];

export function registerPreHook(toolName: string | '*', hook: PreHook): void {
  if (toolName === '*') {
    globalPreHooks.push(hook);
  } else {
    const hooks = preHooks.get(toolName) || [];
    hooks.push(hook);
    preHooks.set(toolName, hooks);
  }
}

export function registerPostHook(toolName: string | '*', hook: PostHook): void {
  if (toolName === '*') {
    globalPostHooks.push(hook);
  } else {
    const hooks = postHooks.get(toolName) || [];
    hooks.push(hook);
    postHooks.set(toolName, hooks);
  }
}

export async function runPreHooks(context: HookContext): Promise<PreHookResult> {
  let currentParams = { ...context.params };

  // Run global hooks first
  for (const hook of globalPreHooks) {
    const result = await hook({ ...context, params: currentParams });
    if (!result.proceed) {
      return result;
    }
    if (result.modifiedParams) {
      currentParams = result.modifiedParams;
    }
  }

  // Run tool-specific hooks
  const toolHooks = preHooks.get(context.toolName) || [];
  for (const hook of toolHooks) {
    const result = await hook({ ...context, params: currentParams });
    if (!result.proceed) {
      return result;
    }
    if (result.modifiedParams) {
      currentParams = result.modifiedParams;
    }
  }

  return { proceed: true, modifiedParams: currentParams };
}

export async function runPostHooks(
  context: HookContext,
  result: ToolResult
): Promise<PostHookResult> {
  let currentResult = result;

  // Run tool-specific hooks first
  const toolHooks = postHooks.get(context.toolName) || [];
  for (const hook of toolHooks) {
    const hookResult = await hook(context, currentResult);
    currentResult = hookResult.result;
    if (hookResult.shouldRetry) {
      return hookResult;
    }
    if (hookResult.followUpAction) {
      return hookResult;
    }
  }

  // Run global hooks
  for (const hook of globalPostHooks) {
    const hookResult = await hook(context, currentResult);
    currentResult = hookResult.result;
    if (hookResult.shouldRetry) {
      return hookResult;
    }
  }

  return { result: currentResult };
}

// =============================================================================
// File Access Tracking (for Read-Before-Write)
// =============================================================================

const fileReadCache = new Map<string, { content: string; timestamp: number }>();
const FILE_CACHE_TTL = 30000; // 30 seconds

export function recordFileRead(filePath: string, content: string): void {
  fileReadCache.set(filePath, {
    content,
    timestamp: Date.now(),
  });
}

export function hasRecentlyRead(filePath: string): boolean {
  const entry = fileReadCache.get(filePath);
  if (!entry) return false;
  return Date.now() - entry.timestamp < FILE_CACHE_TTL;
}

export function getLastReadContent(filePath: string): string | null {
  const entry = fileReadCache.get(filePath);
  if (!entry) return null;
  if (Date.now() - entry.timestamp >= FILE_CACHE_TTL) {
    fileReadCache.delete(filePath);
    return null;
  }
  return entry.content;
}

export function clearFileCache(): void {
  fileReadCache.clear();
}

// =============================================================================
// Error Pattern Recognition
// =============================================================================

export interface ErrorPattern {
  pattern: RegExp;
  type: 'recoverable' | 'fatal' | 'retry';
  suggestion: string;
  autoFix?: (context: HookContext, match: RegExpMatchArray) => Record<string, unknown> | null;
}

const errorPatterns: ErrorPattern[] = [
  {
    pattern: /String not found in file/,
    type: 'recoverable',
    suggestion: 'Try expanding the search context or check for whitespace differences',
  },
  {
    pattern: /File not found: (.+)/,
    type: 'recoverable',
    suggestion: 'Verify the file path exists. Use Glob to find similar files.',
  },
  {
    pattern: /String found (\d+) times/,
    type: 'recoverable',
    suggestion: 'Add more surrounding context to make the match unique',
  },
  {
    pattern: /Permission denied/,
    type: 'fatal',
    suggestion: 'File permissions prevent this operation',
  },
  {
    pattern: /ENOENT/,
    type: 'recoverable',
    suggestion: 'Path does not exist. Create parent directories first.',
  },
  {
    pattern: /EACCES/,
    type: 'fatal',
    suggestion: 'Access denied. Check file permissions.',
  },
];

export function analyzeError(error: string): {
  type: 'recoverable' | 'fatal' | 'retry' | 'unknown';
  suggestion?: string;
  pattern?: ErrorPattern;
} {
  for (const pattern of errorPatterns) {
    if (pattern.pattern.test(error)) {
      return {
        type: pattern.type,
        suggestion: pattern.suggestion,
        pattern,
      };
    }
  }
  return { type: 'unknown' };
}

// =============================================================================
// Self-Correction State
// =============================================================================

export interface CorrectionAttempt {
  toolName: string;
  originalParams: Record<string, unknown>;
  error: string;
  correctedParams: Record<string, unknown>;
  timestamp: number;
}

const correctionHistory: CorrectionAttempt[] = [];
const MAX_CORRECTION_HISTORY = 50;

export function recordCorrectionAttempt(attempt: CorrectionAttempt): void {
  correctionHistory.push(attempt);
  if (correctionHistory.length > MAX_CORRECTION_HISTORY) {
    correctionHistory.shift();
  }
}

export function getRecentCorrections(toolName?: string, limit = 10): CorrectionAttempt[] {
  const filtered = toolName
    ? correctionHistory.filter(c => c.toolName === toolName)
    : correctionHistory;
  return filtered.slice(-limit);
}

// =============================================================================
// Index Invalidation Callback
// =============================================================================

// Callback to invalidate codebase index when files are modified
let indexInvalidationCallback: (() => void) | null = null;

export function setIndexInvalidationCallback(callback: () => void): void {
  indexInvalidationCallback = callback;
}

function invalidateIndexOnFileChange(): void {
  if (indexInvalidationCallback) {
    indexInvalidationCallback();
  }
}

// =============================================================================
// Default Hooks Setup
// =============================================================================

export function setupDefaultHooks(): void {
  // Read-before-write enforcement for Edit and Write
  registerPreHook('Edit', async (context) => {
    const filePath = context.params.file_path as string;
    if (!filePath) {
      return { proceed: true };
    }

    if (!hasRecentlyRead(filePath)) {
      return {
        proceed: false,
        error: `Read-before-write: File "${filePath}" must be read before editing`,
        suggestion: 'Use the Read tool to view the file contents first',
      };
    }

    return { proceed: true };
  });

  registerPreHook('Write', async (context) => {
    const filePath = context.params.file_path as string;
    if (!filePath) {
      return { proceed: true };
    }

    // For new files, no read required
    // For existing files, require read
    const { existsSync } = await import('fs');
    if (existsSync(filePath) && !hasRecentlyRead(filePath)) {
      return {
        proceed: false,
        error: `Read-before-write: Existing file "${filePath}" must be read before overwriting`,
        suggestion: 'Use the Read tool to view the file contents first',
      };
    }

    return { proceed: true };
  });

  // Invalidate codebase index when files are modified
  registerPostHook('Edit', async (_context, result) => {
    if (result.success) {
      invalidateIndexOnFileChange();
    }
    return { result };
  });

  registerPostHook('Write', async (_context, result) => {
    if (result.success) {
      invalidateIndexOnFileChange();
    }
    return { result };
  });

  // Global error analysis hook
  registerPostHook('*', async (context, result) => {
    if (result.success) {
      return { result };
    }

    const errorMsg = result.error || '';
    const analysis = analyzeError(errorMsg);

    if (analysis.suggestion) {
      return {
        result: {
          ...result,
          errorType: analysis.type,
          suggestion: analysis.suggestion,
        },
      };
    }

    return { result };
  });
}
