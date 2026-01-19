import { useCallback, useRef } from 'react';
import { tools, executeToolByName } from '../tools/index.js';
import { getMcpClient, isRemoteTool } from '../services/mcp.js';
import { checkDangerousCommand } from '../utils/safety.js';
import type { ToolResult, Todo, PendingQuestion, PendingPermission } from '../types.js';

interface PendingTool {
  id: string;
  name: string;
  input: Record<string, unknown>;
}

interface ToolExecutionResult {
  tool_use_id: string;
  content: string;
}

interface UseToolsCallbacks {
  onTodoUpdate?: (todos: Todo[]) => void;
  onAskUser?: (question: PendingQuestion) => Promise<string>;
  onPermissionRequest?: (permission: PendingPermission) => Promise<boolean>;
  skipPermissions?: boolean;
}

interface UseToolsReturn {
  executeTools: (pendingTools: PendingTool[], callbacks?: UseToolsCallbacks) => Promise<ToolExecutionResult[]>;
  availableTools: typeof tools;
}

// Tools that require user interaction or sequential execution
const SEQUENTIAL_TOOLS = new Set(['TodoWrite', 'AskUser', 'AskUserQuestion', 'Bash']);

// Use centralized safety check - returns description if dangerous, null if safe
function checkDangerous(command: string): { isDangerous: boolean; operation: string } {
  const danger = checkDangerousCommand(command);
  return danger
    ? { isDangerous: true, operation: danger }
    : { isDangerous: false, operation: '' };
}

export function useTools(): UseToolsReturn {
  const executeTools = useCallback(async (
    pendingTools: PendingTool[],
    callbacks?: UseToolsCallbacks
  ): Promise<ToolExecutionResult[]> => {
    // Separate tools into sequential (need UI/permissions) and parallel (can run concurrently)
    const sequentialTools: PendingTool[] = [];
    const parallelTools: PendingTool[] = [];

    for (const tool of pendingTools) {
      if (SEQUENTIAL_TOOLS.has(tool.name)) {
        sequentialTools.push(tool);
      } else {
        parallelTools.push(tool);
      }
    }

    const results: ToolExecutionResult[] = [];
    const resultsMap = new Map<string, ToolExecutionResult>();

    // Execute parallel tools concurrently (Read, Edit, Write, Glob, Grep, MCP tools)
    if (parallelTools.length > 0) {
      const parallelResults = await Promise.all(
        parallelTools.map(tool => executeOneTool(tool, callbacks))
      );
      parallelResults.forEach(result => resultsMap.set(result.tool_use_id, result));
    }

    // Execute sequential tools one at a time (TodoWrite, AskUser, Bash)
    for (const tool of sequentialTools) {
      const result = await executeOneTool(tool, callbacks);
      resultsMap.set(result.tool_use_id, result);
    }

    // Maintain original order
    for (const tool of pendingTools) {
      const result = resultsMap.get(tool.id);
      if (result) {
        results.push(result);
      }
    }

    return results;
  }, []);

  return {
    executeTools,
    availableTools: tools,
  };
}

// Execute a single tool - extracted for parallel execution
async function executeOneTool(
  tool: PendingTool,
  callbacks?: UseToolsCallbacks
): Promise<ToolExecutionResult> {
  try {
    // Handle TodoWrite specially
    if (tool.name === 'TodoWrite') {
      const todos = tool.input.todos as Todo[];
      if (callbacks?.onTodoUpdate && todos) {
        callbacks.onTodoUpdate(todos);
      }
      const completed = todos?.filter((t) => t.status === 'completed').length || 0;
      const total = todos?.length || 0;
      return {
        tool_use_id: tool.id,
        content: JSON.stringify({
          success: true,
          message: `Updated todo list: ${completed}/${total} completed`,
        }),
      };
    }

    // Handle AskUser specially
    if (tool.name === 'AskUser' || tool.name === 'AskUserQuestion') {
      if (callbacks?.onAskUser) {
        const answer = await callbacks.onAskUser({
          toolId: tool.id,
          question: tool.input.question as string,
          options: tool.input.options as string[] | undefined,
        });
        return {
          tool_use_id: tool.id,
          content: JSON.stringify({ success: true, answer }),
        };
      } else {
        return {
          tool_use_id: tool.id,
          content: JSON.stringify({ success: true, answer: '(no answer - non-interactive mode)' }),
        };
      }
    }

    // Handle Bash with permission check
    if (tool.name === 'Bash' && !callbacks?.skipPermissions) {
      const command = tool.input.command as string;
      const { isDangerous, operation } = checkDangerous(command);

      if (isDangerous && callbacks?.onPermissionRequest) {
        const allowed = await callbacks.onPermissionRequest({
          toolId: tool.id,
          operation,
          command,
        });

        if (!allowed) {
          return {
            tool_use_id: tool.id,
            content: JSON.stringify({
              success: false,
              error: 'Operation cancelled by user',
              cancelled: true,
            }),
          };
        }
      }
    }

    // Check if this is a remote tool (MCP) or local tool
    if (isRemoteTool(tool.name)) {
      const mcp = getMcpClient();
      if (mcp) {
        // Execute via MCP (Whale data tools)
        try {
          const mcpResult = await mcp.callTool(tool.name, tool.input);
          let resultData: unknown = mcpResult;
          if (typeof mcpResult === 'string') {
            try {
              resultData = JSON.parse(mcpResult);
            } catch {
              // Keep as string if not valid JSON
            }
          }
          return {
            tool_use_id: tool.id,
            content: JSON.stringify({ success: true, ...spreadData(resultData) }),
          };
        } catch (mcpError) {
          return {
            tool_use_id: tool.id,
            content: JSON.stringify({
              success: false,
              error: `MCP tool '${tool.name}' failed: ${mcpError instanceof Error ? mcpError.message : 'Unknown error'}`,
            }),
          };
        }
      } else {
        return {
          tool_use_id: tool.id,
          content: JSON.stringify({
            success: false,
            error: `Tool '${tool.name}' requires MCP server but MCP is not connected. Please restart the app.`,
          }),
        };
      }
    }

    // Local execution
    const result = await executeToolByName(tool.name, tool.input);
    return {
      tool_use_id: tool.id,
      content: JSON.stringify(result),
    };
  } catch (error) {
    const errorResult: ToolResult = {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
    return {
      tool_use_id: tool.id,
      content: JSON.stringify(errorResult),
    };
  }
}

// Helper to spread data object into result, preserving structure for charts
function spreadData(data: unknown): Record<string, unknown> {
  if (typeof data === 'object' && data !== null && !Array.isArray(data)) {
    const obj = data as Record<string, unknown>;
    if (obj.query_type || obj.data) {
      return obj;
    }
    return { data };
  }
  if (Array.isArray(data)) {
    return { data };
  }
  return { data: String(data) };
}
