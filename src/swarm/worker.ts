import type { SwarmTask, SwarmIPC, TaskResult } from './types.js';
import {
  getIPCPaths,
  popFromGoalQueue,
  pushToCompletionQueue,
  updateState,
  readState,
  sendMessage,
} from './queue.js';
import { sendChatRequest } from '../services/api.js';

// =============================================================================
// Swarm Worker
// A worker process that pulls tasks from the queue and executes them
// =============================================================================

interface WorkerConfig {
  workerId: string;
  workingDirectory: string;
  accessToken: string;
  storeId: string;
}

/**
 * Run the worker loop
 * Continuously pulls tasks from queue and executes them
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

    // Execute the task
    try {
      const result = await executeTask(task, config);

      task.result = result;
      task.status = 'validating';
      task.completedAt = Date.now();

      console.log(`✓ Worker ${workerId}: Task completed, sending for validation`);

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
      console.error(`✗ Worker ${workerId}: Task failed - ${err.message}`);

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
 * Execute a single task using Wilson AI
 */
async function executeTask(task: SwarmTask, config: WorkerConfig): Promise<TaskResult> {
  const { workingDirectory, accessToken, storeId } = config;

  // Build the execution prompt
  const prompt = `You are a focused AI worker executing a specific task as part of a larger project.

TASK: ${task.description}

CONTEXT:
- Working directory: ${workingDirectory}
- This is task ${task.id} in a multi-agent workflow
- Other tasks may depend on your output

INSTRUCTIONS:
1. Execute this task completely
2. Use the available tools (bash, file operations, etc.)
3. Be thorough but focused on just this task
4. Report exactly what files you created or modified

When complete, respond with a summary in this format:
TASK COMPLETE
Files created: [list of files]
Files modified: [list of files]
Summary: [brief description of what was done]`;

  // Execute with Wilson
  const history: Array<{ role: string; content: unknown }> = [
    { role: 'user', content: prompt }
  ];

  let fullResponse = '';
  const filesCreated: string[] = [];
  const filesModified: string[] = [];

  try {
    const response = await sendChatRequest({
      message: prompt,
      conversationHistory: history,
      accessToken,
      storeId,
    });

    // Process the streamed response
    const reader = response.body?.getReader();
    if (!reader) throw new Error('No response body');

    const decoder = new TextDecoder();
    let loopCount = 0;
    const maxLoops = 50; // Safety limit

    while (loopCount < maxLoops) {
      loopCount++;

      // Read stream
      let iterationResponse = '';
      let pendingTools: any[] = [];
      let assistantContent: unknown[] = [];

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value);
        const lines = chunk.split('\n');

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;

          try {
            const data = JSON.parse(line.slice(6));

            if (data.type === 'text_delta' && data.content) {
              iterationResponse += data.content;
              process.stdout.write(data.content);
            }

            if (data.type === 'tools_pending') {
              pendingTools = data.pending_tools || [];
              assistantContent = data.assistant_content || [];
            }

            if (data.type === 'error') {
              throw new Error(data.error);
            }
          } catch (parseErr) {
            // Ignore JSON parse errors in stream
          }
        }
      }

      fullResponse += iterationResponse;

      // If there were tools, we need to continue (tool results come from backend)
      if (pendingTools.length === 0) {
        break;
      }

      // For now, break after first iteration - full tool loop would require
      // more infrastructure. The backend handles tool execution for us.
      break;
    }

    // Parse the completion response
    if (fullResponse.includes('TASK COMPLETE')) {
      const createdMatch = fullResponse.match(/Files created:\s*\[(.*?)\]/s);
      const modifiedMatch = fullResponse.match(/Files modified:\s*\[(.*?)\]/s);

      if (createdMatch) {
        filesCreated.push(...createdMatch[1].split(',').map(s => s.trim()).filter(Boolean));
      }
      if (modifiedMatch) {
        filesModified.push(...modifiedMatch[1].split(',').map(s => s.trim()).filter(Boolean));
      }

      return {
        success: true,
        output: fullResponse,
        filesCreated,
        filesModified,
      };
    } else {
      // Task didn't explicitly complete, might need more work
      return {
        success: true,
        output: fullResponse,
        filesCreated,
        filesModified,
      };
    }

  } catch (err: any) {
    return {
      success: false,
      error: err.message,
    };
  }
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
