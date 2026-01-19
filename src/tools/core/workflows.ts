/**
 * Wilson Workflows & Tool Chaining
 *
 * Composite tool operations for common patterns:
 * - Read → Edit → Verify chain
 * - Build → Test → Deploy pipeline
 * - Search → Fix → Commit workflow
 *
 * Based on patterns observed in Claude Code usage
 */

import type { ToolResult } from '../../types.js';
import { recordFileRead } from './hooks.js';
import { runTask } from './task-manager.js';
import { readFileSync, existsSync } from 'fs';

// =============================================================================
// Types
// =============================================================================

export interface WorkflowStep {
  name: string;
  tool: string;
  params: Record<string, unknown>;
  condition?: (prevResults: ToolResult[]) => boolean;
  transform?: (params: Record<string, unknown>, prevResults: ToolResult[]) => Record<string, unknown>;
  onError?: 'skip' | 'abort' | 'continue';
}

export interface WorkflowResult {
  success: boolean;
  steps: Array<{
    name: string;
    result: ToolResult;
    skipped?: boolean;
  }>;
  summary: string;
}

export interface WorkflowDefinition {
  name: string;
  description: string;
  steps: WorkflowStep[];
}

// =============================================================================
// Workflow Registry
// =============================================================================

const workflows: Map<string, WorkflowDefinition> = new Map();

export function registerWorkflow(workflow: WorkflowDefinition): void {
  workflows.set(workflow.name, workflow);
}

export function getWorkflow(name: string): WorkflowDefinition | undefined {
  return workflows.get(name);
}

export function listWorkflows(): WorkflowDefinition[] {
  return Array.from(workflows.values());
}

// =============================================================================
// Workflow Execution
// =============================================================================

export async function executeWorkflow(
  definition: WorkflowDefinition,
  executeTool: (name: string, params: Record<string, unknown>) => Promise<ToolResult>,
  initialParams?: Record<string, unknown>
): Promise<WorkflowResult> {
  const results: WorkflowResult['steps'] = [];
  let aborted = false;

  for (const step of definition.steps) {
    if (aborted) {
      results.push({ name: step.name, result: { success: false, error: 'Workflow aborted' }, skipped: true });
      continue;
    }

    // Check condition
    if (step.condition) {
      const prevResults = results.map(r => r.result);
      if (!step.condition(prevResults)) {
        results.push({ name: step.name, result: { success: true, content: 'Skipped by condition' }, skipped: true });
        continue;
      }
    }

    // Transform params if needed
    let params = { ...step.params, ...initialParams };
    if (step.transform) {
      params = step.transform(params, results.map(r => r.result));
    }

    // Execute step
    const result = await executeTool(step.tool, params);
    results.push({ name: step.name, result });

    // Handle errors
    if (!result.success) {
      switch (step.onError) {
        case 'abort':
          aborted = true;
          break;
        case 'skip':
          // Continue to next step
          break;
        case 'continue':
        default:
          // Continue with workflow
          break;
      }
    }
  }

  const successCount = results.filter(r => r.result.success && !r.skipped).length;
  const totalSteps = results.filter(r => !r.skipped).length;

  return {
    success: successCount === totalSteps,
    steps: results,
    summary: `${definition.name}: ${successCount}/${totalSteps} steps completed`,
  };
}

// =============================================================================
// Built-in Workflows
// =============================================================================

// Safe Edit: Read → Edit → Verify
registerWorkflow({
  name: 'safe-edit',
  description: 'Safely edit a file with read verification',
  steps: [
    {
      name: 'Read file',
      tool: 'Read',
      params: {},
      transform: (params) => ({ file_path: params.file_path }),
    },
    {
      name: 'Edit file',
      tool: 'Edit',
      params: {},
      condition: (prev) => prev[0]?.success === true,
      onError: 'abort',
    },
    {
      name: 'Verify edit',
      tool: 'Read',
      params: {},
      transform: (params) => ({ file_path: params.file_path }),
    },
  ],
});

// Build & Test: Build → Run tests → Report
registerWorkflow({
  name: 'build-test',
  description: 'Build project and run tests',
  steps: [
    {
      name: 'Build',
      tool: 'Bash',
      params: { command: 'npm run build' },
      onError: 'abort',
    },
    {
      name: 'Type check',
      tool: 'Bash',
      params: { command: 'npm run typecheck' },
      onError: 'continue',
    },
    {
      name: 'Run tests',
      tool: 'Bash',
      params: { command: 'npm test' },
      onError: 'continue',
    },
  ],
});

// Git Commit: Stage → Commit → Push
registerWorkflow({
  name: 'git-commit',
  description: 'Stage, commit, and optionally push changes',
  steps: [
    {
      name: 'Stage changes',
      tool: 'Git',
      params: { action: 'add', path: '.' },
    },
    {
      name: 'Create commit',
      tool: 'Git',
      params: { action: 'commit' },
      onError: 'abort',
    },
  ],
});

// =============================================================================
// Common Composite Operations
// =============================================================================

/**
 * Read a file and ensure it's cached for editing
 */
export async function readForEdit(filePath: string): Promise<ToolResult> {
  if (!existsSync(filePath)) {
    return { success: false, error: `File not found: ${filePath}` };
  }

  try {
    const content = readFileSync(filePath, 'utf8');
    recordFileRead(filePath, content);

    const lines = content.split('\n');
    const preview = lines.slice(0, 50).map((line, i) =>
      `${String(i + 1).padStart(4)}│ ${line}`
    ).join('\n');

    return {
      success: true,
      content: preview,
      totalLines: lines.length,
      cachedForEdit: true,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to read file',
    };
  }
}

/**
 * Run a command and analyze its output for errors
 */
export async function runAndAnalyze(
  command: string,
  options: { cwd?: string; timeout?: number } = {}
): Promise<ToolResult> {
  const task = await runTask('sh', ['-c', command], {
    cwd: options.cwd,
    timeout: options.timeout || 60000,
  });

  const output = task.output.join('');
  const errors = task.errors.join('');

  // Analyze for common error patterns
  const issues: string[] = [];

  if (/error TS\d+/i.test(output + errors)) {
    issues.push('TypeScript errors detected');
  }
  if (/SyntaxError|ReferenceError|TypeError/i.test(output + errors)) {
    issues.push('JavaScript runtime errors detected');
  }
  if (/FAILED|FAIL\s/i.test(output)) {
    issues.push('Test failures detected');
  }
  if (/Cannot find module/i.test(output + errors)) {
    issues.push('Missing module dependencies');
  }
  if (/ENOENT/i.test(errors)) {
    issues.push('File or directory not found');
  }

  return {
    success: task.exitCode === 0,
    output: output.slice(-5000), // Last 5k chars
    errors: errors.slice(-2000),
    exitCode: task.exitCode,
    issues: issues.length > 0 ? issues : undefined,
    executionTime: task.endTime ? task.endTime - task.startTime : undefined,
  };
}

/**
 * Find and fix: Search for pattern, suggest fixes
 */
export async function findAndSuggestFix(
  pattern: string,
  filePattern: string = '**/*.ts',
  cwd?: string
): Promise<ToolResult> {
  const searchResult = await runAndAnalyze(
    `grep -rn "${pattern}" --include="${filePattern}" . 2>/dev/null | head -20`,
    { cwd }
  );

  const output = searchResult.output as string | undefined;
  if (!searchResult.success || !output) {
    return {
      success: false,
      error: 'Pattern not found',
      pattern,
    };
  }

  const matches = output.trim().split('\n').filter(Boolean);

  return {
    success: true,
    matches: matches.map((m: string) => {
      const [location, ...rest] = m.split(':');
      const [file, line] = location.split(':');
      return {
        file: file?.replace('./', ''),
        line: parseInt(line || '0', 10),
        content: rest.join(':').trim(),
      };
    }),
    count: matches.length,
    suggestion: `Found ${matches.length} matches. Review each location before making changes.`,
  };
}

/**
 * Health check: Run multiple diagnostics
 */
export async function runHealthCheck(cwd?: string): Promise<ToolResult> {
  const checks: Array<{ name: string; command: string; required: boolean }> = [
    { name: 'package.json', command: 'test -f package.json && echo OK', required: true },
    { name: 'node_modules', command: 'test -d node_modules && echo OK', required: false },
    { name: 'TypeScript', command: 'npx tsc --noEmit 2>&1 | tail -5', required: false },
    { name: 'Git status', command: 'git status --porcelain 2>&1 | head -10', required: false },
  ];

  const results: Array<{ name: string; status: 'ok' | 'warning' | 'error'; message?: string }> = [];

  for (const check of checks) {
    const result = await runAndAnalyze(check.command, { cwd, timeout: 30000 });

    const resultOutput = result.output as string | undefined;
    const resultErrors = result.errors as string | undefined;
    if (result.success && resultOutput?.includes('OK')) {
      results.push({ name: check.name, status: 'ok' });
    } else if (check.required) {
      results.push({
        name: check.name,
        status: 'error',
        message: resultErrors || resultOutput,
      });
    } else {
      results.push({
        name: check.name,
        status: 'warning',
        message: resultOutput?.slice(0, 200),
      });
    }
  }

  const hasErrors = results.some(r => r.status === 'error');

  return {
    success: !hasErrors,
    checks: results,
    summary: `${results.filter(r => r.status === 'ok').length}/${results.length} checks passed`,
  };
}

// =============================================================================
// Self-Correction Patterns
// =============================================================================

/**
 * Retry with exponential backoff
 */
export async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  maxRetries: number = 3,
  baseDelay: number = 1000
): Promise<T> {
  let lastError: Error | undefined;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));

      if (attempt < maxRetries - 1) {
        const delay = baseDelay * Math.pow(2, attempt);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }

  throw lastError;
}

/**
 * Auto-correct common edit mistakes
 */
export function suggestEditCorrection(
  originalOldString: string,
  fileContent: string
): { suggestion: string; confidence: number } | null {
  // Try without trailing/leading whitespace
  const trimmed = originalOldString.trim();
  if (fileContent.includes(trimmed)) {
    return {
      suggestion: trimmed,
      confidence: 0.9,
    };
  }

  // Try with normalized line endings
  const normalized = originalOldString.replace(/\r\n/g, '\n');
  if (fileContent.includes(normalized)) {
    return {
      suggestion: normalized,
      confidence: 0.95,
    };
  }

  // Try first line only (common mistake: including extra context)
  const firstLine = originalOldString.split('\n')[0];
  if (firstLine && firstLine.length > 20 && fileContent.includes(firstLine)) {
    // Find the actual line in context
    const lines = fileContent.split('\n');
    const idx = lines.findIndex(l => l.includes(firstLine) || firstLine.includes(l.trim()));
    if (idx !== -1) {
      return {
        suggestion: lines[idx],
        confidence: 0.7,
      };
    }
  }

  return null;
}
