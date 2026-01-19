import { execSync } from 'child_process';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import type { SwarmTask, SwarmState, TaskResult, SwarmIPC } from './types.js';
import {
  popFromCompletionQueue,
  updateState,
  pushToGoalQueue,
  sendMessage,
  readState,
} from './queue.js';

// =============================================================================
// Validator Agent
// Validates completed tasks before marking them as truly done
// =============================================================================

interface ValidationContext {
  workingDirectory: string;
  goal: string;
  completedTasks: SwarmTask[];
}

/**
 * Run the validator loop
 * This runs in its own tmux pane and validates completed tasks
 */
export async function runValidatorLoop(
  paths: SwarmIPC,
  onStatusUpdate?: (status: string) => void
): Promise<void> {
  const log = (msg: string) => {
    onStatusUpdate?.(msg);
    console.log(`[Validator] ${msg}`);
  };

  log('Starting validator loop...');

  while (true) {
    const state = readState(paths);
    if (!state) {
      log('No swarm state found, exiting');
      break;
    }

    if (state.status === 'completed' || state.status === 'failed') {
      log(`Swarm ${state.status}, validator shutting down`);
      break;
    }

    // Check for completed tasks to validate
    const task = await popFromCompletionQueue(paths);

    if (!task) {
      // No tasks to validate, check if we're done
      const pendingTasks = state.goalQueue.filter(
        t => t.status === 'pending' || t.status === 'in_progress'
      );

      if (pendingTasks.length === 0 && state.completionQueue.length === 0) {
        // All done!
        await updateState(paths, s => ({
          ...s,
          status: 'completed',
          completedAt: Date.now(),
          progress: 100,
          validator: { ...s.validator, status: 'idle' },
        }));
        log('All tasks completed! Swarm finished.');
        break;
      }

      // Wait and poll again
      await sleep(1000);
      continue;
    }

    log(`Validating task: ${task.description}`);

    // Update validator status
    await updateState(paths, s => ({
      ...s,
      validator: {
        ...s.validator,
        status: 'validating',
        currentTaskId: task.id,
      },
    }));

    // Run validation
    const context: ValidationContext = {
      workingDirectory: state.workingDirectory,
      goal: state.goal,
      completedTasks: state.completedTasks,
    };

    const validationResult = await validateTask(task, context);

    if (validationResult.success) {
      log(`Task validated: ${task.description}`);

      // Mark as completed
      task.status = 'completed';
      task.completedAt = Date.now();
      task.result = {
        success: true,
        ...task.result,
        validationPassed: true,
        validationNotes: validationResult.notes,
      };

      await updateState(paths, s => ({
        ...s,
        completedTasks: [...s.completedTasks, task],
        progress: calculateProgress(s.completedTasks.length + 1, s),
        validator: {
          ...s.validator,
          status: 'idle',
          currentTaskId: undefined,
          validationsCompleted: s.validator.validationsCompleted + 1,
          validationsPassed: s.validator.validationsPassed + 1,
        },
      }));

      // Notify commander
      await sendMessage(paths, {
        type: 'validation_result',
        from: 'validator',
        to: 'commander',
        payload: { taskId: task.id, passed: true },
      });
    } else {
      log(`Task failed validation: ${task.description} - ${validationResult.reason}`);

      // Check retry count
      if (task.retryCount < task.maxRetries) {
        // Requeue for retry
        task.status = 'pending';
        task.retryCount++;
        task.result = {
          success: false,
          ...task.result,
          validationPassed: false,
          validationNotes: validationResult.reason,
        };

        await pushToGoalQueue(paths, task);

        await updateState(paths, s => ({
          ...s,
          validator: {
            ...s.validator,
            status: 'idle',
            currentTaskId: undefined,
            validationsCompleted: s.validator.validationsCompleted + 1,
            validationsFailed: s.validator.validationsFailed + 1,
          },
        }));
      } else {
        // Max retries exceeded, mark as failed
        task.status = 'failed';
        task.result = {
          success: false,
          ...task.result,
          validationPassed: false,
          validationNotes: `Failed after ${task.maxRetries} retries: ${validationResult.reason}`,
        };

        await updateState(paths, s => ({
          ...s,
          failedTasks: [...s.failedTasks, task],
          validator: {
            ...s.validator,
            status: 'idle',
            currentTaskId: undefined,
            validationsCompleted: s.validator.validationsCompleted + 1,
            validationsFailed: s.validator.validationsFailed + 1,
          },
        }));
      }

      // Notify commander
      await sendMessage(paths, {
        type: 'validation_result',
        from: 'validator',
        to: 'commander',
        payload: { taskId: task.id, passed: false, reason: validationResult.reason },
      });
    }
  }
}

// =============================================================================
// Validation Logic
// =============================================================================

interface ValidationResult {
  success: boolean;
  reason?: string;
  notes?: string;
}

/**
 * Validate a completed task
 */
async function validateTask(task: SwarmTask, context: ValidationContext): Promise<ValidationResult> {
  // Multiple validation strategies
  const checks: Array<() => Promise<ValidationResult>> = [
    () => checkFilesExist(task, context),
    () => checkSyntax(task, context),
    () => checkBuildPasses(context),
    () => checkTestsPassing(context),
  ];

  for (const check of checks) {
    const result = await check();
    if (!result.success) {
      return result;
    }
  }

  return { success: true, notes: 'All validation checks passed' };
}

/**
 * Check that created/modified files exist
 */
async function checkFilesExist(task: SwarmTask, context: ValidationContext): Promise<ValidationResult> {
  const files = [
    ...(task.result?.filesCreated || []),
    ...(task.result?.filesModified || []),
  ];

  for (const file of files) {
    const fullPath = join(context.workingDirectory, file);
    if (!existsSync(fullPath)) {
      return {
        success: false,
        reason: `Expected file not found: ${file}`,
      };
    }
  }

  return { success: true };
}

/**
 * Check syntax of modified files (TypeScript/JavaScript)
 */
async function checkSyntax(task: SwarmTask, context: ValidationContext): Promise<ValidationResult> {
  const files = [
    ...(task.result?.filesCreated || []),
    ...(task.result?.filesModified || []),
  ].filter(f => f.endsWith('.ts') || f.endsWith('.tsx') || f.endsWith('.js') || f.endsWith('.jsx'));

  if (files.length === 0) {
    return { success: true };
  }

  // Quick syntax check using tsc --noEmit on specific files
  try {
    const fileList = files.map(f => join(context.workingDirectory, f)).join(' ');
    execSync(`npx tsc --noEmit ${fileList} 2>&1`, {
      cwd: context.workingDirectory,
      encoding: 'utf8',
      timeout: 30000,
    });
    return { success: true };
  } catch (err: any) {
    // tsc returns non-zero on errors
    const output = err.stdout || err.stderr || err.message;
    return {
      success: false,
      reason: `Syntax errors: ${output.slice(0, 500)}`,
    };
  }
}

/**
 * Check if the build passes
 */
async function checkBuildPasses(context: ValidationContext): Promise<ValidationResult> {
  // Check if package.json exists and has a build script
  const packageJsonPath = join(context.workingDirectory, 'package.json');
  if (!existsSync(packageJsonPath)) {
    return { success: true }; // No package.json, skip build check
  }

  try {
    const pkg = JSON.parse(readFileSync(packageJsonPath, 'utf8'));
    if (!pkg.scripts?.build) {
      return { success: true }; // No build script, skip
    }

    // Run build
    execSync('npm run build 2>&1', {
      cwd: context.workingDirectory,
      encoding: 'utf8',
      timeout: 120000, // 2 minute timeout for build
    });

    return { success: true };
  } catch (err: any) {
    const output = err.stdout || err.stderr || err.message;
    return {
      success: false,
      reason: `Build failed: ${output.slice(0, 500)}`,
    };
  }
}

/**
 * Check if tests pass (optional, only if test script exists)
 */
async function checkTestsPassing(context: ValidationContext): Promise<ValidationResult> {
  const packageJsonPath = join(context.workingDirectory, 'package.json');
  if (!existsSync(packageJsonPath)) {
    return { success: true };
  }

  try {
    const pkg = JSON.parse(readFileSync(packageJsonPath, 'utf8'));
    if (!pkg.scripts?.test || pkg.scripts.test.includes('echo')) {
      return { success: true }; // No real test script, skip
    }

    // Run tests
    execSync('npm test 2>&1', {
      cwd: context.workingDirectory,
      encoding: 'utf8',
      timeout: 120000,
    });

    return { success: true };
  } catch (err: any) {
    const output = err.stdout || err.stderr || err.message;
    return {
      success: false,
      reason: `Tests failed: ${output.slice(0, 500)}`,
    };
  }
}

// =============================================================================
// Helpers
// =============================================================================

function calculateProgress(completedCount: number, state: SwarmState): number {
  const total = state.goalQueue.length + state.completionQueue.length +
                state.completedTasks.length + state.failedTasks.length + 1;
  return Math.round((completedCount / total) * 100);
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
