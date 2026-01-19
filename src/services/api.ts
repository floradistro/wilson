import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { config } from '../config.js';
import { getToolSchemas } from '../tools/index.js';
import { getMcpClient } from './mcp.js';
import { processHistoryForApi, getContextManagementConfig } from '../utils/context-manager.js';
import { buildSystemPrompt, loadSettings } from '../lib/config-loader.js';
import { loadProviderSettings } from './storage.js';
import { loadExistingIndex, buildIndex, type CodebaseIndex } from '../indexer/index.js';
import type { StoreInfo, ToolSchema } from '../types.js';
import type { AIProvider } from '../providers/types.js';

// Cache for codebase index
let cachedCodebaseIndex: CodebaseIndex | null = null;
let indexedRoot: string | null = null;

// =============================================================================
// API Client
// =============================================================================

interface SendChatOptions {
  message: string;
  // Full conversation history - client accumulates all tool calls
  conversationHistory: Array<{ role: string; content: unknown }>;
  accessToken: string;
  storeId?: string;
  // Loop tracking from backend - must send back on continuation
  toolCallCount?: number;
  loopDepth?: number;
  // AI Provider selection
  provider?: AIProvider;
  model?: string;
}

const API_TIMEOUT = 120000; // 2 minute timeout for API calls

export async function sendChatRequest(options: SendChatOptions): Promise<Response> {
  const {
    message,
    conversationHistory,
    accessToken,
    storeId,
    toolCallCount,
    loopDepth,
    provider: optionsProvider,
    model: optionsModel,
  } = options;

  // Get provider/model from options or saved settings
  const providerSettings = loadProviderSettings();
  const provider = optionsProvider || providerSettings.provider;
  const model = optionsModel || providerSettings.model;

  // Load settings and build system prompt (Anthropic pattern)
  // This includes all instructions, loop prevention, and project memory (WILSON.md)
  const settings = loadSettings();
  const systemPrompt = buildSystemPrompt(settings);

  // Get codebase index summary (helps Claude understand project structure)
  const codebaseSummary = getCodebaseSummary();

  // Send ALL tools (local + MCP) to the backend
  // This includes file ops, bash, store tools, AND MCP data tools
  const allTools = getAllToolSchemas();

  // Process history to truncate large tool inputs/outputs (client-side optimization)
  const processedHistory = processHistoryForApi(conversationHistory);

  // Server-side context management config (safety net)
  const contextManagement = getContextManagementConfig();

  const body = {
    message,
    // Send processed conversation history with truncated tool content
    history: processedHistory,
    store_id: storeId,
    working_directory: process.cwd(),
    platform: process.platform,
    client: 'cli',
    format_hint: 'terminal',
    local_tools: allTools,
    // Loop tracking - backend uses these to enforce limits
    tool_call_count: toolCallCount,
    loop_depth: loopDepth,
    // Codebase index summary (helps Claude understand project structure)
    codebase_summary: codebaseSummary,
    // Server-side context management (safety net for token overflow)
    context_management: contextManagement,
    // AI Provider selection
    provider,
    model,
    // Complete system prompt (includes style, behavior, loop prevention, and project memory)
    system_prompt: systemPrompt,
  };

  // Create abort controller for timeout
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), API_TIMEOUT);

  try {
    const response = await fetch(`${config.apiUrl}/functions/v1/agentic-loop`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${accessToken}`,
        'apikey': config.anonKey,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`API error: ${response.status} - ${text}`);
    }

    return response;
  } catch (error) {
    clearTimeout(timeoutId);

    if (error instanceof Error) {
      if (error.name === 'AbortError') {
        throw new Error(`API request timed out after ${API_TIMEOUT / 1000}s`);
      }
      throw error;
    }
    throw new Error('Network error');
  }
}

// =============================================================================
// Auth API
// =============================================================================

interface AuthResult {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  user: {
    id: string;
    email: string;
  };
}

export async function loginWithPassword(
  email: string,
  password: string
): Promise<AuthResult | null> {
  try {
    const response = await fetch(`${config.apiUrl}/auth/v1/token?grant_type=password`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': config.anonKey,
      },
      body: JSON.stringify({ email, password }),
    });

    if (!response.ok) {
      return null;
    }

    const data = await response.json();
    return {
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      expiresAt: Date.now() + (data.expires_in * 1000),
      user: {
        id: data.user.id,
        email: data.user.email,
      },
    };
  } catch {
    return null;
  }
}

export async function getUserStore(userId: string): Promise<StoreInfo | null> {
  try {
    const response = await fetch(
      `${config.apiUrl}/rest/v1/users?auth_user_id=eq.${userId}&select=id,store_id,role,stores(id,store_name)`,
      {
        headers: {
          'apikey': config.serviceKey,
          'Authorization': `Bearer ${config.serviceKey}`,
        },
      }
    );

    if (!response.ok) {
      return null;
    }

    const data = await response.json();
    if (!data.length || !data[0].store_id) {
      return null;
    }

    return {
      storeId: data[0].store_id,
      storeName: data[0].stores?.store_name || 'Unknown Store',
      role: data[0].role || 'user',
    };
  } catch {
    return null;
  }
}

export async function refreshAccessToken(
  refreshToken: string
): Promise<{ accessToken: string; expiresAt: number } | null> {
  try {
    const response = await fetch(`${config.apiUrl}/auth/v1/token?grant_type=refresh_token`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': config.anonKey,
      },
      body: JSON.stringify({ refresh_token: refreshToken }),
    });

    if (!response.ok) {
      return null;
    }

    const data = await response.json();
    return {
      accessToken: data.access_token,
      expiresAt: Date.now() + (data.expires_in * 1000),
    };
  } catch {
    return null;
  }
}

// =============================================================================
// Helpers
// =============================================================================

// Cache MCP tools to avoid blocking on every request
let cachedMcpTools: ToolSchema[] | null = null;

// Minimum files to index - skip empty/nearly-empty directories
const MIN_FILES_TO_INDEX = 3;
// Maximum time to spend indexing (ms)
const INDEX_TIMEOUT = 10000;

/**
 * Pre-build codebase index for faster first request. Call at startup.
 * Non-blocking - runs in background and times out if too slow.
 */
export async function prebuildCodebaseIndex(): Promise<void> {
  const cwd = process.cwd();

  // Skip if already indexed this directory
  if (cachedCodebaseIndex && indexedRoot === cwd) {
    return;
  }

  // Clear stale cache if directory changed
  if (indexedRoot && indexedRoot !== cwd) {
    cachedCodebaseIndex = null;
    indexedRoot = null;
  }

  // Try to load existing index first (fast)
  try {
    const existing = loadExistingIndex(cwd);
    if (existing && existing.stats.fileCount >= MIN_FILES_TO_INDEX) {
      cachedCodebaseIndex = existing;
      indexedRoot = cwd;
      return;
    }
  } catch {
    // Fall through to build
  }

  // Build new index with timeout to prevent hangs
  try {
    const indexPromise = buildIndex(cwd, { includeSemantics: false });
    const timeoutPromise = new Promise<null>((resolve) =>
      setTimeout(() => resolve(null), INDEX_TIMEOUT)
    );

    const index = await Promise.race([indexPromise, timeoutPromise]);

    if (index && index.stats.fileCount >= MIN_FILES_TO_INDEX) {
      cachedCodebaseIndex = index;
      indexedRoot = cwd;
    }
  } catch {
    // Indexing failed, continue without it
  }
}

/**
 * Invalidate the index cache - call when directory changes or files are modified.
 */
export function invalidateCodebaseIndex(): void {
  cachedCodebaseIndex = null;
  indexedRoot = null;
}

/**
 * Refresh index if the working directory changed.
 * Call this on each request to ensure index is fresh.
 */
export function refreshIndexIfNeeded(): void {
  const cwd = process.cwd();
  if (indexedRoot && indexedRoot !== cwd) {
    // Directory changed - invalidate and rebuild in background
    invalidateCodebaseIndex();
    prebuildCodebaseIndex().catch(() => {});
  }
}

/**
 * Pre-fetch MCP tools into cache. Call this after MCP client is initialized.
 */
export async function prefetchMcpTools(): Promise<void> {
  const mcp = getMcpClient();
  if (mcp && !cachedMcpTools) {
    try {
      cachedMcpTools = await mcp.getToolSchemas();
    } catch {
      // MCP failed, will use local tools only
    }
  }
}

/**
 * Get all tool schemas - local tools plus cached MCP tools (deduplicated).
 */
function getAllToolSchemas(): ToolSchema[] {
  const localTools = getToolSchemas();

  // First dedupe local tools (in case there are duplicates)
  const seenNames = new Set<string>();
  const dedupedLocal: ToolSchema[] = [];
  for (const tool of localTools) {
    const name = tool.name.toLowerCase();
    if (seenNames.has(name)) {
      console.error(`[DEBUG] Duplicate local tool: ${tool.name}`);
    } else {
      seenNames.add(name);
      dedupedLocal.push(tool);
    }
  }

  // Return cached MCP tools if available
  if (cachedMcpTools) {
    // Deduplicate by name (case-insensitive) - local tools take priority
    const uniqueMcpTools: ToolSchema[] = [];
    for (const tool of cachedMcpTools) {
      const name = tool.name.toLowerCase();
      if (seenNames.has(name)) {
        console.error(`[DEBUG] Duplicate MCP tool (skipping): ${tool.name}`);
      } else {
        seenNames.add(name);
        uniqueMcpTools.push(tool);
      }
    }

    const result = [...dedupedLocal, ...uniqueMcpTools];

    // Final verification - check for any remaining duplicates
    const finalNames = result.map(t => t.name.toLowerCase());
    const finalDupes = finalNames.filter((name, i) => finalNames.indexOf(name) !== i);
    if (finalDupes.length > 0) {
      console.error(`[DEBUG] FINAL DUPLICATES FOUND: ${finalDupes.join(', ')}`);
    }

    return result;
  }

  return dedupedLocal;
}

// Get or build codebase index summary for system prompt
function getCodebaseSummary(): string | undefined {
  const cwd = process.cwd();

  // Check if directory changed and refresh if needed
  refreshIndexIfNeeded();

  // Return cached if same directory and has enough files
  if (cachedCodebaseIndex && indexedRoot === cwd && cachedCodebaseIndex.stats.fileCount >= MIN_FILES_TO_INDEX) {
    return formatIndexSummary(cachedCodebaseIndex);
  }

  // Try to load existing index (fast)
  try {
    const existing = loadExistingIndex(cwd);
    if (existing && existing.stats.fileCount >= MIN_FILES_TO_INDEX) {
      cachedCodebaseIndex = existing;
      indexedRoot = cwd;
      return formatIndexSummary(existing);
    }
  } catch {
    // Indexing failed, continue without it
  }

  // No index exists or too few files - build one in background for next time
  // Don't block the request, and use timeout to prevent hangs
  const indexPromise = buildIndex(cwd, { includeSemantics: false });
  const timeoutPromise = new Promise<null>((resolve) =>
    setTimeout(() => resolve(null), INDEX_TIMEOUT)
  );

  Promise.race([indexPromise, timeoutPromise])
    .then(index => {
      if (index && index.stats.fileCount >= MIN_FILES_TO_INDEX) {
        cachedCodebaseIndex = index;
        indexedRoot = cwd;
      }
    })
    .catch(() => {
      // Silently ignore indexing failures
    });

  return undefined;
}

function formatIndexSummary(index: CodebaseIndex): string {
  const { stats, scan, symbols } = index;

  // Group files by directory
  const dirCounts = new Map<string, number>();
  for (const file of scan.files) {
    const dir = file.path.split('/').slice(0, -1).join('/') || '.';
    dirCounts.set(dir, (dirCounts.get(dir) || 0) + 1);
  }

  // Top directories
  const topDirs = [...dirCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([dir, count]) => `  ${dir}/ (${count} files)`)
    .join('\n');

  // Key symbols (exported functions/classes)
  const exportedSymbols = symbols
    .filter(s => s.exported && (s.kind === 'function' || s.kind === 'class'))
    .slice(0, 20)
    .map(s => `  ${s.kind}: ${s.name} (${s.file}:${s.line})`)
    .join('\n');

  return `
CODEBASE INDEX (auto-generated):
Files: ${stats.fileCount} | Symbols: ${stats.symbolCount}

Top directories:
${topDirs}

Key exports:
${exportedSymbols || '  (none found)'}

Use the Search tool for semantic queries, or Read specific files.
`.trim();
}
