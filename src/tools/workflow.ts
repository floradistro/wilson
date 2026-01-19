/**
 * Workflow Tool
 *
 * Executes predefined workflows (tool chains) or custom sequences.
 * Built-in workflows:
 * - safe-edit: Read → Edit → Verify
 * - build-test: Build → Type check → Tests
 * - git-commit: Stage → Commit
 */

import type { Tool, ToolResult } from '../types.js';
import {
  listWorkflows,
  getWorkflow,
  executeWorkflow,
  readForEdit,
  runAndAnalyze,
  runHealthCheck,
} from './core/workflows.js';

// Note: We can't import executeToolByName due to circular dependency
// The 'run' action for custom workflows is disabled until refactored

// =============================================================================
// Workflow Schema
// =============================================================================

export const WorkflowSchema = {
  name: 'Workflow',
  description: 'Execute predefined workflows or tool chains. Actions: list, run, safe-edit, build-test, health',
  parameters: {
    type: 'object' as const,
    properties: {
      action: {
        type: 'string' as const,
        description: 'Action to perform',
        enum: ['list', 'run', 'safe-edit', 'build-test', 'health', 'run-check'],
      },
      workflow: {
        type: 'string' as const,
        description: 'Workflow name for run action',
      },
      file_path: {
        type: 'string' as const,
        description: 'File path for safe-edit action',
      },
      old_string: {
        type: 'string' as const,
        description: 'String to replace for safe-edit action',
      },
      new_string: {
        type: 'string' as const,
        description: 'Replacement string for safe-edit action',
      },
      command: {
        type: 'string' as const,
        description: 'Command to run and analyze',
      },
      cwd: {
        type: 'string' as const,
        description: 'Working directory',
      },
    },
    required: ['action'],
  },
};

// =============================================================================
// Workflow Tool Implementation
// =============================================================================

interface WorkflowParams {
  action: 'list' | 'run' | 'safe-edit' | 'build-test' | 'health' | 'run-check';
  workflow?: string;
  file_path?: string;
  old_string?: string;
  new_string?: string;
  command?: string;
  cwd?: string;
}

export const workflowTool: Tool = {
  schema: WorkflowSchema,

  async execute(params: Record<string, unknown>): Promise<ToolResult> {
    const { action, workflow, file_path, old_string, new_string, command, cwd } = params as unknown as WorkflowParams;

    switch (action) {
      case 'list': {
        const workflows = listWorkflows();
        return {
          success: true,
          workflows: workflows.map(w => ({
            name: w.name,
            description: w.description,
            steps: w.steps.map(s => s.name),
          })),
        };
      }

      case 'run': {
        // Custom workflow execution is disabled due to circular dependency
        // Use specific workflow actions (safe-edit, build-test) instead
        return {
          success: false,
          error: 'Custom workflow execution not available. Use specific actions: safe-edit, build-test, health, run-check',
        };
      }

      case 'safe-edit': {
        if (!file_path) {
          return { success: false, error: 'Missing file_path' };
        }

        // Step 1: Read file
        const readResult = await readForEdit(file_path);
        if (!readResult.success) {
          return readResult;
        }

        // If no edit params provided, just return the read result
        if (!old_string || !new_string) {
          return {
            success: true,
            content: readResult.content,
            message: 'File read and cached. Ready for edit.',
            cachedForEdit: true,
          };
        }

        // Step 2: Perform edit - import smartEdit directly to avoid circular dep
        const { smartEdit } = await import('./core/smart-edit.js');
        const editResult = await smartEdit({
          file_path,
          old_string,
          new_string,
        });

        if (!editResult.success) {
          return editResult;
        }

        // Step 3: Verify
        const verifyResult = await readForEdit(file_path);

        return {
          success: true,
          workflow: 'safe-edit',
          edit: editResult,
          verification: {
            success: verifyResult.success,
            linesAfterEdit: verifyResult.totalLines,
          },
        };
      }

      case 'build-test': {
        const results: Array<{ step: string; success: boolean; output?: string; errors?: string }> = [];

        // Build
        const buildResult = await runAndAnalyze('npm run build', { cwd });
        results.push({
          step: 'build',
          success: buildResult.success,
          output: buildResult.output as string | undefined,
          errors: buildResult.errors as string | undefined,
        });

        if (!buildResult.success) {
          return {
            success: false,
            workflow: 'build-test',
            failedAt: 'build',
            results,
            issues: buildResult.issues,
          };
        }

        // Type check
        const typeResult = await runAndAnalyze('npm run typecheck', { cwd });
        results.push({
          step: 'typecheck',
          success: typeResult.success,
          output: typeResult.output as string | undefined,
          errors: typeResult.errors as string | undefined,
        });

        // Test (continue even if typecheck fails)
        const testResult = await runAndAnalyze('npm test', { cwd });
        results.push({
          step: 'test',
          success: testResult.success,
          output: testResult.output as string | undefined,
          errors: testResult.errors as string | undefined,
        });

        const allSuccess = results.every(r => r.success);

        return {
          success: allSuccess,
          workflow: 'build-test',
          results,
          summary: `${results.filter(r => r.success).length}/${results.length} steps passed`,
        };
      }

      case 'health': {
        return runHealthCheck(cwd);
      }

      case 'run-check': {
        if (!command) {
          return { success: false, error: 'Missing command' };
        }
        return runAndAnalyze(command, { cwd });
      }

      default:
        return { success: false, error: `Unknown action: ${action}` };
    }
  },
};

export const workflowTools = {
  Workflow: workflowTool,
};
