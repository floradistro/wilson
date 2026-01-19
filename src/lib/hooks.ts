/**
 * Hooks System
 * Follows Anthropic's Claude Code pattern:
 *
 * Hooks are SHELL COMMANDS (not LLM-based) that run at lifecycle points.
 * This provides deterministic, predictable enforcement.
 *
 * Hook Events:
 * - PreToolUse: Before a tool executes (can block)
 * - PostToolUse: After a tool executes (can modify result)
 * - PreResponse: Before response is displayed (can transform)
 *
 * Hooks receive JSON via stdin and return:
 * - Exit 0: Allow/continue
 * - Exit 2: Block/reject
 * - Stderr: Message to display
 */

import { exec } from 'child_process';
import { promisify } from 'util';
import { loadSettings, type HookConfig } from './config-loader.js';

const execAsync = promisify(exec);

// =============================================================================
// Types
// =============================================================================

export interface ToolContext {
  name: string;
  input: Record<string, unknown>;
  timestamp: string;
}

export interface ToolResultContext extends ToolContext {
  result: unknown;
  elapsed_ms: number;
  isError: boolean;
}

export interface ResponseContext {
  content: string;
  toolCalls: number;
  timestamp: string;
}

export interface HookResult {
  allowed: boolean;
  message?: string;
  modifiedData?: unknown;
}

// =============================================================================
// Hook Execution
// =============================================================================

/**
 * Execute a single hook command
 */
async function executeHook(
  command: string,
  context: unknown,
  timeoutMs: number = 5000
): Promise<HookResult> {
  try {
    const input = JSON.stringify(context);

    const { stdout, stderr } = await execAsync(command, {
      timeout: timeoutMs,
      env: {
        ...process.env,
        WILSON_HOOK_INPUT: input,
      },
      // Pass context via stdin
      input,
    });

    return {
      allowed: true,
      message: stderr?.trim() || undefined,
      modifiedData: stdout ? tryParseJson(stdout) : undefined,
    };
  } catch (error: unknown) {
    const execError = error as { code?: number; stderr?: string; killed?: boolean };

    // Exit code 2 = blocked
    if (execError.code === 2) {
      return {
        allowed: false,
        message: execError.stderr?.trim() || 'Blocked by hook',
      };
    }

    // Timeout or other error - log but don't block
    if (execError.killed) {
      console.error(`Hook timed out: ${command}`);
    }

    // Other errors - allow but warn
    return {
      allowed: true,
      message: `Hook error: ${execError.stderr || 'Unknown error'}`,
    };
  }
}

/**
 * Check if a hook matcher matches a tool name
 */
function matchesHook(matcher: string | undefined, toolName: string): boolean {
  if (!matcher || matcher === '*') return true;

  // Support patterns like "Bash|Edit|Write"
  if (matcher.includes('|')) {
    const patterns = matcher.split('|');
    return patterns.some((p) => matchesHook(p.trim(), toolName));
  }

  // Support glob-style wildcards
  if (matcher.endsWith('*')) {
    return toolName.startsWith(matcher.slice(0, -1));
  }

  return matcher === toolName;
}

function tryParseJson(str: string): unknown | undefined {
  try {
    return JSON.parse(str.trim());
  } catch {
    return undefined;
  }
}

// =============================================================================
// Public API
// =============================================================================

/**
 * Run PreToolUse hooks before executing a tool
 * Returns { allowed: false } to block the tool
 */
export async function runPreToolHooks(context: ToolContext): Promise<HookResult> {
  const settings = loadSettings();
  const hooks = settings.hooks.PreToolUse || [];

  for (const hookConfig of hooks) {
    if (matchesHook(hookConfig.matcher, context.name)) {
      const result = await executeHook(hookConfig.command, context);
      if (!result.allowed) {
        return result;
      }
    }
  }

  return { allowed: true };
}

/**
 * Run PostToolUse hooks after a tool executes
 * Can modify the result via stdout
 */
export async function runPostToolHooks(context: ToolResultContext): Promise<HookResult> {
  const settings = loadSettings();
  const hooks = settings.hooks.PostToolUse || [];

  let currentContext = context;

  for (const hookConfig of hooks) {
    if (matchesHook(hookConfig.matcher, context.name)) {
      const result = await executeHook(hookConfig.command, currentContext);

      // If hook returned modified data, use it
      if (result.modifiedData !== undefined) {
        currentContext = {
          ...currentContext,
          result: result.modifiedData,
        };
      }
    }
  }

  return {
    allowed: true,
    modifiedData: currentContext.result,
  };
}

/**
 * Run PreResponse hooks before displaying response
 * Can transform the response content
 */
export async function runPreResponseHooks(context: ResponseContext): Promise<HookResult> {
  const settings = loadSettings();
  const hooks = settings.hooks.PreResponse || [];

  let currentContent = context.content;

  for (const hookConfig of hooks) {
    const result = await executeHook(hookConfig.command, {
      ...context,
      content: currentContent,
    });

    // If hook returned modified data, use it as the new content
    if (result.modifiedData && typeof result.modifiedData === 'string') {
      currentContent = result.modifiedData;
    }
  }

  return {
    allowed: true,
    modifiedData: currentContent,
  };
}

// =============================================================================
// Example Hook Scripts
// =============================================================================

/**
 * Example hooks (for documentation):
 *
 * PreToolUse - Block dangerous operations:
 * ```bash
 * #!/bin/bash
 * # .wilson/hooks/block-deletes.sh
 * input=$(cat)
 * name=$(echo "$input" | jq -r '.name')
 * if [[ "$name" == *"delete"* ]]; then
 *   echo "Delete operations are blocked" >&2
 *   exit 2
 * fi
 * exit 0
 * ```
 *
 * PostToolUse - Log all tool calls:
 * ```bash
 * #!/bin/bash
 * # .wilson/hooks/log-tools.sh
 * input=$(cat)
 * echo "$input" >> ~/.wilson/tool-log.jsonl
 * exit 0
 * ```
 *
 * PreResponse - Add footer:
 * ```bash
 * #!/bin/bash
 * # .wilson/hooks/add-footer.sh
 * input=$(cat)
 * content=$(echo "$input" | jq -r '.content')
 * echo "${content}\n\n---\nPowered by Wilson"
 * exit 0
 * ```
 */
