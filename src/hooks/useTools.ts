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
    const results: ToolExecutionResult[] = [];

    // Process tools sequentially for special tools (TodoWrite, AskUser need UI)
    for (const tool of pendingTools) {
      try {
        // Handle TodoWrite specially
        if (tool.name === 'TodoWrite') {
          const todos = tool.input.todos as Todo[];
          if (callbacks?.onTodoUpdate && todos) {
            callbacks.onTodoUpdate(todos);
          }
          const completed = todos?.filter((t) => t.status === 'completed').length || 0;
          const total = todos?.length || 0;
          results.push({
            tool_use_id: tool.id,
            content: JSON.stringify({
              success: true,
              message: `Updated todo list: ${completed}/${total} completed`,
            }),
          });
          continue;
        }

        // Handle AskUser specially
        if (tool.name === 'AskUser') {
          if (callbacks?.onAskUser) {
            const answer = await callbacks.onAskUser({
              toolId: tool.id,
              question: tool.input.question as string,
              options: tool.input.options as string[] | undefined,
            });
            results.push({
              tool_use_id: tool.id,
              content: JSON.stringify({ success: true, answer }),
            });
          } else {
            results.push({
              tool_use_id: tool.id,
              content: JSON.stringify({ success: true, answer: '(no answer - non-interactive mode)' }),
            });
          }
          continue;
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
              results.push({
                tool_use_id: tool.id,
                content: JSON.stringify({
                  success: false,
                  error: 'Operation cancelled by user',
                  cancelled: true,
                }),
              });
              continue;
            }
          }
        }

        // Check if this is a remote tool (MCP) or local tool
        // MCP is optional - if not available, try executing locally
        if (isRemoteTool(tool.name)) {
          const mcp = getMcpClient();
          if (mcp) {
            // Execute via MCP (Whale data tools)
            try {
              const mcpResult = await mcp.callTool(tool.name, tool.input);
              // Parse and preserve structured data if it's JSON
              let resultData: unknown = mcpResult;
              if (typeof mcpResult === 'string') {
                try {
                  resultData = JSON.parse(mcpResult);
                } catch {
                  // Keep as string if not valid JSON
                }
              }
              results.push({
                tool_use_id: tool.id,
                content: JSON.stringify({ success: true, ...spreadData(resultData) }),
              });
              continue;
            } catch (mcpError) {
              results.push({
                tool_use_id: tool.id,
                content: JSON.stringify({
                  success: false,
                  error: mcpError instanceof Error ? mcpError.message : 'MCP tool execution failed',
                }),
              });
              continue;
            }
          }
          // MCP not available - fall through to local execution
          // This allows Wilson to work without MCP server
        }

        // Local execution (or fallback when MCP unavailable)
        const result = await executeToolByName(tool.name, tool.input);
        results.push({
          tool_use_id: tool.id,
          content: JSON.stringify(result),
        });
      } catch (error) {
        const errorResult: ToolResult = {
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error',
        };
        results.push({
          tool_use_id: tool.id,
          content: JSON.stringify(errorResult),
        });
      }
    }

    return results;
  }, []);

  return {
    executeTools,
    availableTools: tools,
  };
}

// Helper to spread data object into result, preserving structure for charts
function spreadData(data: unknown): Record<string, unknown> {
  if (typeof data === 'object' && data !== null && !Array.isArray(data)) {
    // If it has query_type, spread the whole thing (analytics result)
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
