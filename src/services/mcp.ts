/**
 * MCP Client for Wilson
 *
 * Spawns and communicates with the Whale MCP server via stdio.
 * Uses the same MCP server that Claude Code uses.
 *
 * Architecture:
 *   Wilson ──stdio──► whale-mcp-server ──► tools-gateway ──► 191 tools
 *
 * Usage:
 *   const mcp = await createMcpClient({ storeId: '...' });
 *   const tools = await mcp.listTools();
 *   const result = await mcp.callTool('products_find', { search: 'flower' });
 */

import { spawn, ChildProcess } from 'child_process';
import { createInterface, Interface } from 'readline';
import { EventEmitter } from 'events';
import { existsSync, realpathSync } from 'fs';
import { join, dirname } from 'path';
import type { ToolSchema } from '../types.js';

// Path to the Whale MCP server - discovered in order of preference:
// 1. WHALE_MCP_PATH environment variable (explicit override)
// 2. ~/.wilson/mcp-server/ (standard user installation)
// 3. ~/.whale/mcp-server/ (alternative location)
// 4. ./mcp-server/ (relative to cwd for development)
function discoverMcpServerPath(): string {
  if (process.env.WHALE_MCP_PATH) {
    return process.env.WHALE_MCP_PATH;
  }

  const homeDir = process.env.HOME || process.env.USERPROFILE || '';

  const candidates = [
    join(homeDir, '.wilson', 'mcp-server', 'index.js'),
    join(homeDir, '.whale', 'mcp-server', 'index.js'),
    join(process.cwd(), 'mcp-server', 'index.js'),
  ];

  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }

  // Return default path - will fail with clear error message in connect()
  return join(homeDir, '.wilson', 'mcp-server', 'index.js');
}

// =============================================================================
// TYPES
// =============================================================================

interface McpTool {
  name: string;
  description: string;
  inputSchema: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
  };
}

interface McpToolResult {
  content: Array<{ type: string; text: string }>;
  isError?: boolean;
}

// =============================================================================
// MCP CLIENT (STDIO)
// =============================================================================

export class McpClient extends EventEmitter {
  private process: ChildProcess | null = null;
  private readline: Interface | null = null;
  private requestId = 0;
  private pendingRequests: Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void }> = new Map();
  private storeId: string;
  private toolsCache: McpTool[] | null = null;
  private connected = false;

  constructor(options: { storeId: string }) {
    super();
    this.storeId = options.storeId;
  }

  /**
   * Connect to the MCP server
   */
  async connect(): Promise<void> {
    if (this.connected) return;

    return new Promise((resolve, reject) => {
      // Discover MCP server path
      const mcpServerPath = discoverMcpServerPath();

      // Verify the server exists before trying to spawn
      if (!existsSync(mcpServerPath)) {
        reject(new Error(
          `MCP server not found at ${mcpServerPath}. ` +
          `Set WHALE_MCP_PATH environment variable or install to ~/.wilson/mcp-server/`
        ));
        return;
      }

      // Resolve symlinks to get the real path - needed for node_modules resolution
      const realPath = realpathSync(mcpServerPath);
      const serverDir = dirname(realPath);

      // Spawn the MCP server process from its directory (for node_modules resolution)
      this.process = spawn('node', [realPath], {
        cwd: serverDir,
        env: {
          ...process.env,
          STORE_ID: this.storeId,
        },
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      if (!this.process.stdout || !this.process.stdin) {
        reject(new Error('Failed to spawn MCP server'));
        return;
      }

      // Parse JSON-RPC responses from stdout
      this.readline = createInterface({
        input: this.process.stdout,
        crlfDelay: Infinity,
      });

      this.readline.on('line', (line) => {
        this.handleResponse(line);
      });

      // Log stderr (MCP server logs go here)
      this.process.stderr?.on('data', (data) => {
        // MCP server logs - can enable for debugging
        // console.error('[MCP]', data.toString());
      });

      this.process.on('error', (error) => {
        this.emit('error', error);
        reject(error);
      });

      this.process.on('close', (code) => {
        this.connected = false;
        this.emit('close', code);
      });

      // Connection timeout - don't hang forever
      const connectionTimeout = setTimeout(() => {
        this.disconnect();
        reject(new Error('MCP connection timeout'));
      }, 5000);

      // Initialize the connection
      this.sendRequest('initialize', {
        protocolVersion: '2024-11-05',
        clientInfo: { name: 'wilson-cli', version: '1.0.0' },
        capabilities: {},
      })
        .then(() => {
          clearTimeout(connectionTimeout);
          this.connected = true;
          resolve();
        })
        .catch((err) => {
          clearTimeout(connectionTimeout);
          reject(err);
        });
    });
  }

  /**
   * Disconnect from the MCP server
   */
  disconnect(): void {
    if (this.process) {
      this.process.kill();
      this.process = null;
    }
    if (this.readline) {
      this.readline.close();
      this.readline = null;
    }
    this.connected = false;
    this.pendingRequests.clear();
  }

  /**
   * List all available tools
   */
  async listTools(): Promise<McpTool[]> {
    if (!this.connected) {
      await this.connect();
    }

    if (this.toolsCache) {
      return this.toolsCache;
    }

    const response = await this.sendRequest('tools/list', {}) as { tools: McpTool[] };
    this.toolsCache = response.tools || [];

    return this.toolsCache;
  }

  /**
   * Call a tool with arguments
   */
  async callTool(name: string, args: Record<string, unknown> = {}): Promise<string> {
    if (!this.connected) {
      await this.connect();
    }

    const response = await this.sendRequest('tools/call', {
      name,
      arguments: args,
    }) as McpToolResult;

    // Extract text content
    if (response.content && response.content.length > 0) {
      return response.content.map((c) => c.text).join('\n');
    }

    return JSON.stringify(response);
  }

  /**
   * Get tool schemas in Wilson format
   */
  async getToolSchemas(): Promise<ToolSchema[]> {
    const mcpTools = await this.listTools();

    return mcpTools.map((tool) => ({
      name: tool.name,
      description: tool.description,
      parameters: {
        type: 'object' as const,
        properties: (tool.inputSchema?.properties || {}) as Record<string, { type: string; description: string }>,
        required: tool.inputSchema?.required || [],
      },
    }));
  }

  /**
   * Check if a tool exists
   */
  async hasTool(name: string): Promise<boolean> {
    const tools = await this.listTools();
    return tools.some((t) => t.name === name);
  }

  /**
   * Invalidate tools cache
   */
  invalidateCache(): void {
    this.toolsCache = null;
  }

  /**
   * Send JSON-RPC request via stdin
   */
  private sendRequest(method: string, params: Record<string, unknown>): Promise<unknown> {
    return new Promise((resolve, reject) => {
      if (!this.process?.stdin) {
        reject(new Error('MCP server not connected'));
        return;
      }

      const id = ++this.requestId;

      const request = {
        jsonrpc: '2.0',
        id,
        method,
        params,
      };

      this.pendingRequests.set(id, { resolve, reject });

      // Send request via stdin
      this.process.stdin.write(JSON.stringify(request) + '\n');

      // Timeout after 60 seconds
      setTimeout(() => {
        if (this.pendingRequests.has(id)) {
          this.pendingRequests.delete(id);
          reject(new Error(`MCP request timeout: ${method}`));
        }
      }, 60000);
    });
  }

  /**
   * Handle JSON-RPC response from stdout
   */
  private handleResponse(line: string): void {
    try {
      const response = JSON.parse(line);

      if (response.id !== undefined && this.pendingRequests.has(response.id)) {
        const { resolve, reject } = this.pendingRequests.get(response.id)!;
        this.pendingRequests.delete(response.id);

        if (response.error) {
          reject(new Error(`MCP error: ${response.error.message}`));
        } else {
          resolve(response.result);
        }
      }
    } catch {
      // Not valid JSON, ignore (could be stderr leak)
    }
  }
}

// =============================================================================
// SINGLETON & HELPERS
// =============================================================================

let mcpClientInstance: McpClient | null = null;

/**
 * Create or get MCP client instance
 */
export async function createMcpClient(options: { storeId: string }): Promise<McpClient> {
  if (!mcpClientInstance) {
    mcpClientInstance = new McpClient(options);
    await mcpClientInstance.connect();
  }
  return mcpClientInstance;
}

/**
 * Get existing MCP client (must call createMcpClient first)
 */
export function getMcpClient(): McpClient | null {
  return mcpClientInstance;
}

// Cache of local tool names for fast lookup
let localToolNamesCache: Set<string> | null = null;

/**
 * Check if a tool should be executed via MCP (remote) vs locally
 */
export function isRemoteTool(toolName: string): boolean {
  // Build cache on first call - includes ALL local tools from registry
  if (!localToolNamesCache) {
    // Import dynamically to avoid circular dependency at module load
    try {
      const { tools } = require('../tools/index.js');
      localToolNamesCache = new Set(Object.keys(tools).map(name => name.toLowerCase()));
    } catch {
      // Fallback to hardcoded list if import fails
      localToolNamesCache = new Set([
        'read', 'write', 'edit', 'bash', 'glob', 'grep', 'ls',
        'todowrite', 'askuserquestion', 'askuser', 'peek', 'sum', 'scan',
        'search', 'index', 'symbol', 'multi', 'fetch', 'supabasefetch',
        'env', 'xcodebuild', 'simctl', 'xcrun', 'swiftpackage', 'xcodeselect',
        'npm', 'git', 'bun', 'devserver', 'debug', 'workflow',
      ]);
    }
    // Also add special tools that are handled in useTools
    localToolNamesCache.add('todowrite');
    localToolNamesCache.add('askuser');
    localToolNamesCache.add('askuserquestion');
  }

  // A tool is remote if it's NOT in our local registry
  return !localToolNamesCache.has(toolName.toLowerCase());
}

/**
 * Cleanup MCP client on process exit
 */
export function cleanupMcp(): void {
  if (mcpClientInstance) {
    mcpClientInstance.disconnect();
    mcpClientInstance = null;
  }
}
