import { execSync, spawn } from 'child_process';
import type { SwarmConfig, SwarmWorker, SwarmState } from './types.js';

// =============================================================================
// tmux Session Manager
// Creates a tmux session with large panes for Wilson workers
// =============================================================================

const SESSION_PREFIX = 'wilson-swarm';

/**
 * Check if tmux is available
 */
export function isTmuxAvailable(): boolean {
  try {
    execSync('which tmux', { encoding: 'utf8', stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

/**
 * Generate a unique session name
 */
export function generateSessionName(): string {
  return `${SESSION_PREFIX}-${Date.now().toString(36)}`;
}

/**
 * Create a swarm with 2 workers side by side (simpler, larger panes)
 * Layout:
 * ┌─────────────────────────┬─────────────────────────┐
 * │       Worker 1          │       Worker 2          │
 * │    (full Wilson UI)     │    (full Wilson UI)     │
 * └─────────────────────────┴─────────────────────────┘
 */
export function createSwarmSession(config: SwarmConfig): {
  sessionName: string;
  workers: SwarmWorker[];
  commanderPaneId: string;
  validatorPaneId: string;
} {
  const sessionName = generateSessionName();
  const workers: SwarmWorker[] = [];

  // Only use 2 workers for larger panes
  const workerCount = 2;

  // Create session with first pane
  execSync(
    `tmux new-session -d -s ${sessionName} -n swarm -x 200 -y 50`,
    { cwd: config.workingDirectory }
  );

  // Configure tmux for better display
  execSync(`tmux set-option -t ${sessionName} pane-border-format " #T "`);
  execSync(`tmux set-option -t ${sessionName} pane-border-status top`);
  execSync(`tmux set-option -t ${sessionName} pane-border-style "fg=colour240"`);
  execSync(`tmux set-option -t ${sessionName} pane-active-border-style "fg=green"`);

  // Disable status bar for cleaner look
  execSync(`tmux set-option -t ${sessionName} status off`);

  // Get first pane ID (Worker 1)
  const pane1 = execSync(
    `tmux display-message -t ${sessionName}:0.0 -p '#{pane_id}'`,
    { encoding: 'utf8' }
  ).trim();
  execSync(`tmux select-pane -t ${pane1} -T "Worker 1"`);
  workers.push({
    id: 'worker-1',
    name: 'Worker 1',
    status: 'idle',
    paneId: pane1,
    tasksCompleted: 0,
    lastActivity: Date.now(),
  });

  // Split horizontally for Worker 2 (50/50 split)
  execSync(`tmux split-window -t ${sessionName}:0.0 -h -l 50%`);
  const pane2 = execSync(
    `tmux display-message -t ${sessionName}:0.1 -p '#{pane_id}'`,
    { encoding: 'utf8' }
  ).trim();
  execSync(`tmux select-pane -t ${pane2} -T "Worker 2"`);
  workers.push({
    id: 'worker-2',
    name: 'Worker 2',
    status: 'idle',
    paneId: pane2,
    tasksCompleted: 0,
    lastActivity: Date.now(),
  });

  // Select first pane
  execSync(`tmux select-pane -t ${pane1}`);

  return {
    sessionName,
    workers,
    commanderPaneId: pane1,
    validatorPaneId: pane2,
  };
}

/**
 * Send a command to a specific pane
 */
export function sendToPane(sessionName: string, paneId: string, command: string): void {
  const escaped = command.replace(/'/g, "'\\''");
  execSync(`tmux send-keys -t ${paneId} '${escaped}' Enter`);
}

/**
 * Start a Wilson instance with a specific task
 * Uses the regular wilson command with the task as initial query
 */
export function startWorkerInPane(
  sessionName: string,
  paneId: string,
  workerId: string,
  workingDirectory: string,
  task: string
): void {
  // Run wilson with the task as initial query
  // Using --dangerously-skip-permissions so it can work autonomously
  const escapedTask = task.replace(/"/g, '\\"').replace(/'/g, "'\\''");
  const command = `cd "${workingDirectory}" && wilson --dangerously-skip-permissions "${escapedTask}"`;
  sendToPane(sessionName, paneId, command);
}

/**
 * Attach to a tmux session
 */
export function attachSession(sessionName: string): void {
  execSync(`tmux attach-session -t ${sessionName}`, { stdio: 'inherit' });
}

/**
 * Kill a tmux session
 */
export function killSession(sessionName: string): void {
  try {
    execSync(`tmux kill-session -t ${sessionName}`, { stdio: 'pipe' });
  } catch {
    // Session may not exist
  }
}

/**
 * List all wilson swarm sessions
 */
export function listSwarmSessions(): string[] {
  try {
    const output = execSync('tmux list-sessions -F "#{session_name}"', { encoding: 'utf8' });
    return output
      .trim()
      .split('\n')
      .filter(name => name.startsWith(SESSION_PREFIX));
  } catch {
    return [];
  }
}

/**
 * Send SIGINT to a pane (Ctrl+C)
 */
export function interruptPane(paneId: string): void {
  try {
    execSync(`tmux send-keys -t ${paneId} C-c`);
  } catch {
    // Ignore errors
  }
}

// =============================================================================
// High-level Swarm Operations
// =============================================================================

/**
 * Spawn a swarm - creates tmux session with worker panes
 */
export function spawnSwarm(config: SwarmConfig): SwarmState {
  if (!isTmuxAvailable()) {
    throw new Error('tmux is not installed. Install it with: brew install tmux');
  }

  const { sessionName, workers } = createSwarmSession(config);

  const state: SwarmState = {
    id: sessionName,
    goal: config.goal,
    status: 'initializing',
    workers,
    validator: {
      status: 'idle',
      validationsCompleted: 0,
      validationsPassed: 0,
      validationsFailed: 0,
    },
    goalQueue: [],
    completionQueue: [],
    completedTasks: [],
    failedTasks: [],
    progress: 0,
    createdAt: Date.now(),
    tmuxSession: sessionName,
    workingDirectory: config.workingDirectory,
  };

  return state;
}

/**
 * Launch workers with their assigned tasks
 */
export function launchSwarmProcesses(state: SwarmState, tasks: string[]): void {
  state.workers.forEach((worker, index) => {
    const task = tasks[index] || state.goal;
    startWorkerInPane(
      state.tmuxSession,
      worker.paneId,
      worker.id,
      state.workingDirectory,
      task
    );
  });
}

/**
 * Shutdown the swarm gracefully
 */
export async function shutdownSwarm(state: SwarmState): Promise<void> {
  for (const worker of state.workers) {
    interruptPane(worker.paneId);
  }
  await new Promise(resolve => setTimeout(resolve, 1000));
  killSession(state.tmuxSession);
}
