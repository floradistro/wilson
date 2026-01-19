import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { config } from '../config.js';
import { getToolSchemas } from '../tools/index.js';
import { getMcpClient } from './mcp.js';
import { processHistoryForApi, getContextManagementConfig } from '../utils/context-manager.js';
import { buildSystemPrompt, loadSettings } from '../lib/config-loader.js';
import { loadProviderSettings } from './storage.js';
import type { StoreInfo, ToolSchema } from '../types.js';
import type { AIProvider } from '../providers/types.js';

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
  const settings = loadSettings();
  const systemPrompt = buildSystemPrompt(settings);

  // Read project context if available (legacy - now handled by buildSystemPrompt)
  const projectContext = getProjectContext();

  // Send ALL tools (local + MCP) to the AI
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
    project_context: projectContext,
    // Server-side context management (safety net for token overflow)
    context_management: contextManagement,
    // AI Provider selection
    provider,
    model,
    // Style instructions for terminal CLI output
    style_instructions: `Terminal CLI. STRICT RULES:

## FORBIDDEN - NEVER DO THESE:
- NO ** bold markers anywhere
- NO emojis
- NO ASCII art charts (no ████ bars, no drawing charts in text)
- NO describing what charts look like
- NO "here's a bar chart showing..."
- NO React/Recharts/visualization code
- NO markdown tables (| col | col |) - the UI renders tables automatically from tool data
- NO repeating data in text that's already shown in charts/tables
- NEVER use creation_save, creation_edit, generate_chart, or any "creation" tools
- NEVER use chart/dashboard/visualization generation tools

## CHARTS & TABLES - AUTOMATIC RENDERING:
Charts and tables render AUTOMATICALLY from tool data. You do NOT create them.
After calling a tool, the data appears as a beautifully formatted chart or table.
DO NOT repeat the data in text - just provide brief insights (1-3 sentences).

## ANALYTICS TOOL:
Analytics tool query_type options - EACH GIVES DIFFERENT VISUALIZATION:
- "summary" → KPI metrics card (totals, averages)
- "trend" → line chart showing daily revenue over time
- "by_location" → table showing breakdown by store location

CRITICAL FOR MULTIPLE VIEWS: To show different data dynamics, call Analytics with DIFFERENT query_types IN ONE RESPONSE:
- Call 1: query_type="summary" for KPIs
- Call 2: query_type="trend" for time series chart
- Call 3: query_type="by_location" for location breakdown

NEVER call the same query_type twice - each query_type shows unique data.

## DATABASE_QUERY FOR CATEGORY/PRODUCT:
For category or product breakdowns (Analytics doesn't support these), use Database_query with these patterns:

CATEGORY: SELECT c.name as category_name, SUM(oi.line_total) as revenue FROM order_items oi JOIN products p ON oi.product_id = p.id JOIN categories c ON p.primary_category_id = c.id WHERE oi.store_id = '[STORE_ID]' GROUP BY c.name ORDER BY revenue DESC LIMIT 10

PRODUCT: SELECT p.name as product_name, SUM(oi.line_total) as revenue FROM order_items oi JOIN products p ON oi.product_id = p.id WHERE oi.store_id = '[STORE_ID]' GROUP BY p.name ORDER BY revenue DESC LIMIT 10

## TEXT FORMAT:
- Plain text only
- Code in \`\`\` fences
- Simple bullet lists with -
- No decorations

${systemPrompt}`,
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

function getProjectContext(): string | undefined {
  const cwd = process.cwd();
  const possibleFiles = ['WILSON.md', 'CLAUDE.md', 'LISA.md', 'AI.md'];

  for (const file of possibleFiles) {
    const filePath = join(cwd, file);
    if (existsSync(filePath)) {
      try {
        const content = readFileSync(filePath, 'utf8');
        // Limit to 10K chars
        return content.slice(0, 10000);
      } catch {
        // Ignore read errors
      }
    }
  }

  return undefined;
}
