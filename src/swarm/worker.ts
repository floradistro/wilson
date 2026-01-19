import { render } from 'ink';
import React from 'react';
import type { SwarmTask, SwarmIPC, TaskResult } from './types.js';
import {
  getIPCPaths,
  popFromGoalQueue,
  pushToCompletionQueue,
  updateState,
  readState,
} from './queue.js';

// =============================================================================
// Swarm Worker
// Runs the full Wilson UI but with a pre-assigned task from the queue
// =============================================================================

interface WorkerConfig {
  workerId: string;
  workingDirectory: string;
  accessToken: string;
  storeId: string;
}

/**
 * Run a worker that uses the full Wilson UI
 * This spawns the actual Wilson app with a task as the initial query
 */
export async function runWorkerLoop(config: WorkerConfig): Promise<void> {
  const { workerId, workingDirectory, accessToken, storeId } = config;
  const paths = getIPCPaths(workingDirectory);

  console.log(`\n🔧 Worker ${workerId} starting...`);
  console.log(`   Working directory: ${workingDirectory}\n`);

  // Update worker status
  await updateWorkerStatus(paths, workerId, 'idle');

  while (true) {
    // Check swarm status
    const state = readState(paths);
    if (!state || state.status === 'completed' || state.status === 'failed') {
      console.log(`Worker ${workerId}: Swarm ended, shutting down`);
      break;
    }

    // Try to get a task
    const task = await popFromGoalQueue(paths);

    if (!task) {
      // No tasks available, wait and retry
      await updateWorkerStatus(paths, workerId, 'idle');
      await sleep(1000);
      continue;
    }

    console.log(`\n📋 Worker ${workerId}: Starting task "${task.description}"`);
    await updateWorkerStatus(paths, workerId, 'working', task.id);

    // Execute the task using the full Wilson app
    try {
      const result = await executeTaskWithWilsonUI(task, config);

      task.result = result;
      task.status = 'validating';
      task.completedAt = Date.now();

      console.log(`\n✓ Worker ${workerId}: Task completed, sending for validation`);

      // Push to completion queue for validation
      await pushToCompletionQueue(paths, task);

      // Update worker stats
      await updateState(paths, s => {
        const worker = s.workers.find(w => w.id === workerId);
        if (worker) {
          worker.tasksCompleted++;
          worker.status = 'idle';
          worker.currentTaskId = undefined;
          worker.lastActivity = Date.now();
        }
        return s;
      });

    } catch (err: any) {
      console.error(`\n✗ Worker ${workerId}: Task failed - ${err.message}`);

      task.result = {
        success: false,
        error: err.message,
      };
      task.status = 'failed';

      // Still send for validation (validator will handle retry logic)
      await pushToCompletionQueue(paths, task);
      await updateWorkerStatus(paths, workerId, 'idle');
    }
  }

  console.log(`Worker ${workerId}: Shutdown complete`);
}

/**
 * Execute a task by running the full Wilson UI with the task as initial query
 */
async function executeTaskWithWilsonUI(task: SwarmTask, config: WorkerConfig): Promise<TaskResult> {
  const { workerId, workingDirectory, accessToken, storeId } = config;

  // Dynamically import the App to avoid circular dependencies
  const { App } = await import('../App.js');
  const { ErrorBoundary } = await import('../components/ErrorBoundary.js');

  // Build task prompt
  const taskPrompt = `[SWARM TASK ${task.id}]

You are Worker ${workerId} in a multi-agent swarm. Execute this task:

${task.description}

Instructions:
- Focus ONLY on this specific task
- Use tools as needed (bash, file operations, etc.)
- When done, say "TASK COMPLETE" and summarize what you did
- List any files you created or modified`;

  return new Promise((resolve) => {
    let completed = false;

    // Render the full Wilson app with the task as initial query
    const { unmount, waitUntilExit } = render(
      React.createElement(ErrorBoundary, null,
        React.createElement(App, {
          initialQuery: taskPrompt,
          flags: { dangerouslySkipPermissions: true }, // Auto-approve in swarm mode
          command: undefined,
        })
      )
    );

    // Set a timeout for task completion (5 minutes)
    const timeout = setTimeout(() => {
      if (!completed) {
        completed = true;
        unmount();
        resolve({
          success: true,
          output: 'Task timed out after 5 minutes',
        });
      }
    }, 5 * 60 * 1000);

    // Wait for the app to exit
    waitUntilExit().then(() => {
      if (!completed) {
        completed = true;
        clearTimeout(timeout);
        resolve({
          success: true,
          output: 'Task completed',
        });
      }
    });
  });
}

/**
 * Update worker status in swarm state
 */
async function updateWorkerStatus(
  paths: SwarmIPC,
  workerId: string,
  status: 'idle' | 'working' | 'waiting',
  currentTaskId?: string
): Promise<void> {
  try {
    await updateState(paths, state => {
      const worker = state.workers.find(w => w.id === workerId);
      if (worker) {
        worker.status = status;
        worker.currentTaskId = currentTaskId;
        worker.lastActivity = Date.now();
      }
      return state;
    });
  } catch {
    // State might not exist yet, ignore
  }
}

// =============================================================================
// Helpers
// =============================================================================

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
