import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { config } from '../config.js';
import { getToolSchemas } from '../tools/index.js';
import { getMcpClient } from './mcp.js';
import { processHistoryForApi, getContextManagementConfig } from '../utils/context-manager.js';
import type { StoreInfo, ToolSchema } from '../types.js';

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
  } = options;

  // Read project context if available
  const projectContext = getProjectContext();

  // Only send local tools - backend already has MCP tools
  const localTools = getToolSchemas();

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
    local_tools: localTools,
    // Loop tracking - backend uses these to enforce limits
    tool_call_count: toolCallCount,
    loop_depth: loopDepth,
    project_context: projectContext,
    // Server-side context management (safety net for token overflow)
    context_management: contextManagement,
    style_instructions: `Terminal CLI. STRICT FORMAT RULES:

NEVER USE: ** markers, emojis, "interactive charts", "visualization"

METRICS (for data summaries):
Summary:
- Revenue: $123,456
- Orders: 1,234
- Avg Order: $50.29

TABLES (for comparisons):
| Period | Revenue |
|--------|---------|
| Today  | $50,000 |

RULES:
1. Bullet values = number ONLY
2. No bold **, no decorations
3. Plain text only`,
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

  // Return cached MCP tools if available
  if (cachedMcpTools) {
    // Deduplicate by name - local tools take priority, then first occurrence of MCP tools
    const seenNames = new Set(localTools.map(t => t.name));
    const uniqueMcpTools: ToolSchema[] = [];
    for (const tool of cachedMcpTools) {
      if (!seenNames.has(tool.name)) {
        seenNames.add(tool.name);
        uniqueMcpTools.push(tool);
      }
    }
    return [...localTools, ...uniqueMcpTools];
  }

  return localTools;
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
