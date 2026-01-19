/**
 * Context Manager - Anthropic-style context optimization
 *
 * Handles both client-side and server-side context management:
 *
 * 1. Client-side (like Claude Code):
 *    - Truncate large tool_use inputs (Write content, etc.)
 *    - Persist large outputs to disk with file reference
 *    - Limit tool result content size
 *
 * 2. Server-side (API beta):
 *    - clear_tool_uses_20250919 strategy
 *    - Automatic clearing of old tool results
 */

import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';
import { log } from './logger.js';

// =============================================================================
// Constants
// =============================================================================

const MAX_TOOL_INPUT_CHARS = 500;       // Truncate tool_use inputs (e.g., Write content)
const MAX_TOOL_OUTPUT_CHARS = 30000;    // Claude Code uses 30K
const MAX_INLINE_OUTPUT_CHARS = 5000;   // Show this much inline, rest in file
const TEMP_DIR = '/tmp/wilson/tool-outputs';

// Tools whose inputs should be truncated in history
const TRUNCATE_INPUT_TOOLS = new Set([
  'Write',
  'Edit',
  'NotebookEdit',
]);

// Tools whose outputs should be preserved (important for context)
const PRESERVE_OUTPUT_TOOLS = new Set([
  'Grep',
  'Glob',
  'Read',
  'Search',
  'database_query',
  'products_find',
]);

// =============================================================================
// Disk Persistence
// =============================================================================

/**
 * Ensure temp directory exists
 */
function ensureTempDir(): void {
  if (!existsSync(TEMP_DIR)) {
    mkdirSync(TEMP_DIR, { recursive: true });
  }
}

/**
 * Persist large output to disk and return a reference
 */
export function persistLargeOutput(
  toolId: string,
  toolName: string,
  content: string
): { persisted: boolean; path?: string; truncated: string } {
  if (content.length <= MAX_TOOL_OUTPUT_CHARS) {
    return { persisted: false, truncated: content };
  }

  ensureTempDir();
  const timestamp = Date.now();
  const safeName = toolName.replace(/[^a-zA-Z0-9]/g, '_');
  const fileName = `${safeName}_${toolId.slice(0, 8)}_${timestamp}.txt`;
  const filePath = join(TEMP_DIR, fileName);

  try {
    writeFileSync(filePath, content);
    log.info(`Persisted large output (${content.length} chars) to ${filePath}`);

    // Return truncated version with file reference
    const preview = content.slice(0, MAX_INLINE_OUTPUT_CHARS);
    const truncated = `${preview}\n\n... [Output truncated - full content saved to ${filePath}] (${content.length} total chars)`;

    return { persisted: true, path: filePath, truncated };
  } catch (error) {
    log.error('Failed to persist large output:', error);
    // Fall back to simple truncation
    return {
      persisted: false,
      truncated: content.slice(0, MAX_TOOL_OUTPUT_CHARS) + '\n\n... [truncated]',
    };
  }
}

// =============================================================================
// Tool Input Truncation
// =============================================================================

/**
 * Truncate tool_use input for history (to avoid sending full file contents back)
 */
export function truncateToolInput(
  toolName: string,
  input: Record<string, unknown>
): Record<string, unknown> {
  if (!TRUNCATE_INPUT_TOOLS.has(toolName)) {
    return input;
  }

  const truncated = { ...input };

  // Truncate content/new_string fields (Write, Edit)
  for (const key of ['content', 'new_string']) {
    if (typeof truncated[key] === 'string') {
      const value = truncated[key] as string;
      if (value.length > MAX_TOOL_INPUT_CHARS) {
        const lines = value.split('\n').length;
        truncated[key] = `[${value.length} chars, ${lines} lines - content truncated for context]`;
        truncated[`_original_${key}_length`] = value.length;
      }
    }
  }

  return truncated;
}

/**
 * Process assistant content blocks to truncate large tool_use inputs
 */
export function truncateAssistantContent(
  content: unknown[]
): unknown[] {
  if (!Array.isArray(content)) return content;

  return content.map(block => {
    if (typeof block !== 'object' || block === null) return block;

    const b = block as Record<string, unknown>;
    if (b.type !== 'tool_use') return block;

    const toolName = b.name as string;
    const input = b.input as Record<string, unknown>;

    if (!toolName || !input) return block;

    const truncatedInput = truncateToolInput(toolName, input);

    // Only create new object if something changed
    if (truncatedInput !== input) {
      return { ...b, input: truncatedInput };
    }

    return block;
  });
}

// =============================================================================
// Tool Result Truncation
// =============================================================================

/**
 * Truncate tool result content for history
 */
export function truncateToolResult(
  toolName: string,
  content: string
): string {
  // Preserve important tool outputs
  if (PRESERVE_OUTPUT_TOOLS.has(toolName)) {
    // Still apply max limit
    if (content.length > MAX_TOOL_OUTPUT_CHARS) {
      const result = persistLargeOutput(`result_${Date.now()}`, toolName, content);
      return result.truncated;
    }
    return content;
  }

  // For other tools (Write, Edit, Bash), truncate more aggressively
  if (content.length > MAX_INLINE_OUTPUT_CHARS) {
    // Check if it's JSON with success field
    try {
      const parsed = JSON.parse(content);
      if (parsed.success !== undefined) {
        // Keep success status, truncate details
        return JSON.stringify({
          success: parsed.success,
          summary: parsed.summary || parsed.message || '[details truncated]',
          _truncated: true,
          _original_length: content.length,
        });
      }
    } catch {
      // Not JSON, truncate as string
    }

    return content.slice(0, MAX_INLINE_OUTPUT_CHARS) + '\n... [truncated]';
  }

  return content;
}

// =============================================================================
// Server-side Context Management Config
// =============================================================================

/**
 * Get context_management config for API requests
 * Uses the clear_tool_uses_20250919 strategy as a safety net
 */
export function getContextManagementConfig(options: {
  threshold?: number;
  keepToolUses?: number;
  excludeTools?: string[];
} = {}): {
  edits: Array<{
    type: string;
    trigger?: { type: string; value: number };
    keep?: { type: string; value: number };
    clear_tool_inputs?: boolean;
    exclude_tools?: string[];
  }>;
} {
  const {
    threshold = 150000,  // 150K tokens - higher threshold since client handles most
    keepToolUses = 5,
    excludeTools = ['Grep', 'Glob', 'Read', 'database_query', 'products_find'],
  } = options;

  return {
    edits: [
      {
        type: 'clear_tool_uses_20250919',
        trigger: {
          type: 'input_tokens',
          value: threshold,
        },
        keep: {
          type: 'tool_uses',
          value: keepToolUses,
        },
        clear_tool_inputs: true,  // Also clear the Write content etc.
        exclude_tools: excludeTools,
      },
    ],
  };
}

// =============================================================================
// Conversation History Processing
// =============================================================================

/**
 * Process conversation history before sending to API
 * Truncates tool inputs and results to stay within context limits
 */
export function processHistoryForApi(
  history: Array<{ role: string; content: unknown }>
): Array<{ role: string; content: unknown }> {
  return history.map(msg => {
    if (!Array.isArray(msg.content)) {
      return msg;
    }

    const processedContent = msg.content.map(block => {
      if (typeof block !== 'object' || block === null) return block;

      const b = block as Record<string, unknown>;

      // Truncate tool_use inputs
      if (b.type === 'tool_use' && b.input && b.name) {
        const truncatedInput = truncateToolInput(
          b.name as string,
          b.input as Record<string, unknown>
        );
        if (truncatedInput !== b.input) {
          return { ...b, input: truncatedInput };
        }
      }

      // Truncate tool_result content
      if (b.type === 'tool_result' && typeof b.content === 'string') {
        const content = b.content as string;
        if (content.length > MAX_INLINE_OUTPUT_CHARS) {
          return {
            ...b,
            content: content.slice(0, MAX_INLINE_OUTPUT_CHARS) + '\n... [result truncated for context]',
          };
        }
      }

      return block;
    });

    return { ...msg, content: processedContent };
  });
}

// =============================================================================
// Exports
// =============================================================================

export const contextLimits = {
  MAX_TOOL_INPUT_CHARS,
  MAX_TOOL_OUTPUT_CHARS,
  MAX_INLINE_OUTPUT_CHARS,
  TRUNCATE_INPUT_TOOLS,
  PRESERVE_OUTPUT_TOOLS,
};
