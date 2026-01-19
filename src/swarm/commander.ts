import type { SwarmConfig, SwarmState, SwarmTask } from './types.js';
import {
  initSwarmDir,
  getIPCPaths,
  writeState,
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
// Orchestrates multiple Wilson instances working on parts of a goal
// =============================================================================

/**
 * Simple task decomposition - splits goal into 2 parallel parts
 */
export async function decomposeGoal(
  goal: string,
  accessToken: string,
  storeId: string,
  workerCount: number = 2
): Promise<string[]> {
  const prompt = `Split this task into exactly ${workerCount} independent parts that can be done in parallel by separate AI agents. Each part should be a complete, standalone task.

GOAL: ${goal}

Respond with ONLY a JSON array of ${workerCount} task descriptions, nothing else:
["task 1 description", "task 2 description"]`;

  try {
    const response = await sendChatRequest({
      message: prompt,
      conversationHistory: [{ role: 'user', content: prompt }],
      accessToken,
      storeId,
    });

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

    // Extract JSON array from response
    const jsonMatch = fullResponse.match(/\[[\s\S]*\]/);
    if (jsonMatch) {
      const tasks = JSON.parse(jsonMatch[0]);
      if (Array.isArray(tasks) && tasks.length > 0) {
        return tasks.slice(0, workerCount);
      }
    }
  } catch (err) {
    console.error('Failed to decompose goal:', err);
  }

  // Fallback: create simple task descriptions
  return [
    `Part 1 of "${goal}" - Focus on the first half of this task`,
    `Part 2 of "${goal}" - Focus on the second half of this task`
  ];
}

/**
 * Start a new swarm - the simple way
 * Creates 2 Wilson instances side by side, each with part of the task
 */
export async function startSwarm(config: SwarmConfig): Promise<SwarmState> {
  if (!isTmuxAvailable()) {
    throw new Error('tmux is required for swarm mode. Install with: brew install tmux');
  }

  console.log(`\n🐝 Starting swarm for: "${config.goal}"\n`);

  // Initialize IPC directory
  const paths = initSwarmDir(config.workingDirectory);

  // Decompose the goal into 2 tasks
  console.log('📋 Splitting task for workers...');
  const tasks = await decomposeGoal(
    config.goal,
    config.accessToken,
    config.storeId,
    2 // Always 2 workers for clean layout
  );
  console.log(`   Worker 1: ${tasks[0]?.slice(0, 60)}${tasks[0]?.length > 60 ? '...' : ''}`);
  console.log(`   Worker 2: ${tasks[1]?.slice(0, 60)}${tasks[1]?.length > 60 ? '...' : ''}`);
  console.log('');

  // Create tmux session with 2 panes
  console.log('🖥️  Creating tmux session...');
  const state = spawnSwarm(config);

  // Save state
  await writeState(paths, state);

  // Launch Wilson in each pane with its task
  console.log('🚀 Launching workers...\n');
  launchSwarmProcesses(state, tasks);

  return state;
}

/**
 * Stop a running swarm
 */
export async function stopSwarm(workingDirectory: string): Promise<void> {
  const paths = getIPCPaths(workingDirectory);

  // Try to read state to get session name
  try {
    const { readState } = await import('./queue.js');
    const state = readState(paths);
    if (state?.tmuxSession) {
      killSession(state.tmuxSession);
    }
  } catch {
    // State might not exist
  }

  // Cleanup directory
  cleanupSwarmDir(workingDirectory);
  console.log('Swarm stopped');
}

/**
 * Get swarm status (for /swarm status command)
 */
export function getSwarmStatus(workingDirectory: string): SwarmState | null {
  const { readState } = require('./queue.js');
  const paths = getIPCPaths(workingDirectory);
  return readState(paths);
}

/**
 * Monitor swarm (not really needed in simple mode)
 */
export async function monitorSwarm(workingDirectory: string): Promise<void> {
  console.log('Swarm monitor - press Ctrl+C to exit');
  // In simple mode, just wait - the tmux session shows everything
  await new Promise(() => {}); // Wait forever
}
