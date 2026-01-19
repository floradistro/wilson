import type { SwarmConfig, SwarmState, SwarmTask, SwarmIPC } from './types.js';
import {
  initSwarmDir,
  getIPCPaths,
  writeState,
  readState,
  pushManyToGoalQueue,
  updateState,
  readMessagesFor,
  clearMessagesFor,
  isSwarmComplete,
  calculateProgress,
  cleanupSwarmDir,
} from './queue.js';
import {
  spawnSwarm,
  launchSwarmProcesses,
  attachSession,
  killSession,
  isTmuxAvailable,
} from './tmux.js';
import { sendChatRequest } from '../services/api.js';

// =============================================================================
// Swarm Commander
// Orchestrates the entire swarm: decomposes goals, spawns workers, monitors progress
// =============================================================================

/**
 * Decompose a high-level goal into tasks using Wilson AI
 */
export async function decomposeGoal(
  goal: string,
  accessToken: string,
  storeId: string,
  workerCount: number
): Promise<SwarmTask[]> {
  const prompt = `You are a task decomposition expert. Break down this goal into ${workerCount} parallel tasks that can be worked on by separate AI agents.

GOAL: ${goal}

Requirements:
1. Each task should be independently workable
2. Identify dependencies between tasks (which tasks must complete before others can start)
3. Be specific about what each task should accomplish
4. Include validation criteria for each task

Respond in this exact JSON format:
{
  "tasks": [
    {
      "id": "task-1",
      "description": "Clear description of what to do",
      "dependencies": [],
      "priority": 1,
      "specialty": "backend|frontend|testing|docs|infra"
    }
  ]
}

Only respond with the JSON, no other text.`;

  try {
    const response = await sendChatRequest({
      message: prompt,
      conversationHistory: [{ role: 'user', content: prompt }],
      accessToken,
      storeId,
    });

    // Read the streamed response
    let fullResponse = '';
    const reader = response.body?.getReader();
    if (!reader) throw new Error('No response body');

    const decoder = new TextDecoder();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      const chunk = decoder.decode(value);
      const lines = chunk.split('\n');

      for (const line of lines) {
        if (line.startsWith('data: ')) {
          try {
            const data = JSON.parse(line.slice(6));
            if (data.type === 'text_delta' && data.content) {
              fullResponse += data.content;
            }
          } catch {
            // Ignore parse errors
          }
        }
      }
    }

    // Extract JSON from response
    const jsonMatch = fullResponse.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error('No JSON found in response');
    }

    const parsed = JSON.parse(jsonMatch[0]);
    const tasks: SwarmTask[] = parsed.tasks.map((t: any, index: number) => ({
      id: t.id || `task-${index + 1}`,
      description: t.description,
      status: 'pending' as const,
      priority: t.priority || index + 1,
      dependencies: t.dependencies || [],
      createdAt: Date.now(),
      retryCount: 0,
      maxRetries: 3,
    }));

    return tasks;
  } catch (err) {
    console.error('Failed to decompose goal:', err);
    // Fallback: create a single task
    return [{
      id: 'task-1',
      description: goal,
      status: 'pending',
      priority: 1,
      dependencies: [],
      createdAt: Date.now(),
      retryCount: 0,
      maxRetries: 3,
    }];
  }
}

/**
 * Start a new swarm
 */
export async function startSwarm(config: SwarmConfig): Promise<SwarmState> {
  if (!isTmuxAvailable()) {
    throw new Error('tmux is required for swarm mode. Install with: brew install tmux');
  }

  console.log(`\n🐝 Initializing swarm for goal: "${config.goal}"\n`);

  // Initialize IPC directory
  const paths = initSwarmDir(config.workingDirectory);

  // Decompose the goal into tasks
  console.log('📋 Decomposing goal into tasks...');
  const tasks = await decomposeGoal(
    config.goal,
    config.accessToken,
    config.storeId,
    config.workerCount
  );
  console.log(`   Created ${tasks.length} tasks\n`);

  // Spawn tmux session
  console.log('🖥️  Spawning tmux session...');
  const state = spawnSwarm(config);
  state.goalQueue = tasks;

  // Write initial state
  await writeState(paths, state);

  // Push tasks to goal queue
  await pushManyToGoalQueue(paths, tasks);

  // Update state to running
  await updateState(paths, s => ({
    ...s,
    status: 'running',
    startedAt: Date.now(),
  }));

  console.log(`   Session: ${state.tmuxSession}`);
  console.log(`   Workers: ${state.workers.length}`);
  console.log('');

  // Launch processes in panes
  console.log('🚀 Launching workers and validator...');
  launchSwarmProcesses(state);

  return state;
}

/**
 * Monitor swarm progress (called from commander pane)
 */
export async function monitorSwarm(workingDirectory: string): Promise<void> {
  const paths = getIPCPaths(workingDirectory);

  console.log('👁️  Swarm Monitor Active');
  console.log('Press Ctrl+C to stop monitoring\n');

  let lastProgress = -1;

  while (true) {
    const state = readState(paths);
    if (!state) {
      console.log('No swarm state found');
      break;
    }

    // Check for messages
    const messages = readMessagesFor(paths, 'commander');
    for (const msg of messages) {
      if (msg.type === 'validation_result') {
        const payload = msg.payload as { taskId: string; passed: boolean; reason?: string };
        if (payload.passed) {
          console.log(`✓ Task validated: ${payload.taskId}`);
        } else {
          console.log(`✗ Task failed validation: ${payload.taskId} - ${payload.reason}`);
        }
      }
    }
    await clearMessagesFor(paths, 'commander');

    // Update progress display
    const progress = calculateProgress(state);
    if (progress !== lastProgress) {
      lastProgress = progress;
      printProgress(state, progress);
    }

    // Check if complete
    if (state.status === 'completed') {
      console.log('\n🎉 Swarm completed successfully!');
      console.log(`   Tasks completed: ${state.completedTasks.length}`);
      console.log(`   Tasks failed: ${state.failedTasks.length}`);
      break;
    }

    if (state.status === 'failed') {
      console.log('\n❌ Swarm failed');
      break;
    }

    await sleep(1000);
  }
}

/**
 * Print progress bar and status
 */
function printProgress(state: SwarmState, progress: number): void {
  const width = 40;
  const filled = Math.round((progress / 100) * width);
  const bar = '█'.repeat(filled) + '░'.repeat(width - filled);

  console.clear();
  console.log('┌─────────────────────────────────────────────────┐');
  console.log(`│ SWARM: ${state.goal.slice(0, 40).padEnd(40)} │`);
  console.log('├─────────────────────────────────────────────────┤');
  console.log(`│ Progress: [${bar}] ${progress}%    │`);
  console.log('├─────────────────────────────────────────────────┤');

  // Worker status
  for (const worker of state.workers) {
    const statusIcon = {
      idle: '⏸',
      working: '⚡',
      waiting: '⏳',
      completed: '✓',
      failed: '✗',
    }[worker.status];
    const task = worker.currentTaskId ?
      state.goalQueue.find(t => t.id === worker.currentTaskId)?.description.slice(0, 25) || '' : '';
    console.log(`│ ${statusIcon} ${worker.name.padEnd(10)} ${task.padEnd(35)} │`);
  }

  console.log('├─────────────────────────────────────────────────┤');
  console.log(`│ Completed: ${state.completedTasks.length}  Failed: ${state.failedTasks.length}  Pending: ${state.goalQueue.filter(t => t.status === 'pending').length}         │`);
  console.log('└─────────────────────────────────────────────────┘');
}

/**
 * Stop a running swarm
 */
export async function stopSwarm(workingDirectory: string): Promise<void> {
  const paths = getIPCPaths(workingDirectory);
  const state = readState(paths);

  if (!state) {
    console.log('No swarm found');
    return;
  }

  console.log('Stopping swarm...');

  // Update state
  await updateState(paths, s => ({
    ...s,
    status: 'failed',
  }));

  // Kill tmux session
  killSession(state.tmuxSession);

  // Cleanup
  cleanupSwarmDir(workingDirectory);

  console.log('Swarm stopped');
}

/**
 * Get swarm status
 */
export function getSwarmStatus(workingDirectory: string): SwarmState | null {
  const paths = getIPCPaths(workingDirectory);
  return readState(paths);
}

// =============================================================================
// Helpers
// =============================================================================

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
