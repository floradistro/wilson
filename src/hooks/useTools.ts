import { useCallback, useRef } from 'react';
import { tools, executeToolByName } from '../tools/index.js';
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

// Dangerous operation patterns
const DANGEROUS_PATTERNS = [
  { pattern: /\brm\s+(-rf?|--force|-r)\s/i, desc: 'recursive/forced delete' },
  { pattern: /\brm\s+.*\*/i, desc: 'wildcard delete' },
  { pattern: /\bDROP\s+(TABLE|DATABASE|INDEX|VIEW)/i, desc: 'DROP statement' },
  { pattern: /\bTRUNCATE\s+TABLE/i, desc: 'TRUNCATE statement' },
  { pattern: /\bDELETE\s+FROM\s+\w+\s*(;|$)/i, desc: 'DELETE without WHERE' },
  { pattern: /\bgit\s+push\s+.*--force/i, desc: 'force push' },
  { pattern: /\bgit\s+reset\s+--hard/i, desc: 'hard reset' },
  { pattern: /\bsudo\s/i, desc: 'sudo command' },
  { pattern: /\bchmod\s+777/i, desc: 'chmod 777' },
];

function checkDangerous(command: string): { isDangerous: boolean; operation: string } {
  for (const { pattern, desc } of DANGEROUS_PATTERNS) {
    if (pattern.test(command)) {
      return { isDangerous: true, operation: desc };
    }
  }
  return { isDangerous: false, operation: '' };
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

        // Regular tool execution
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
