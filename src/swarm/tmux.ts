import { execSync, spawn, ChildProcess } from 'child_process';
import { existsSync } from 'fs';
import type { SwarmConfig, SwarmWorker, SwarmState } from './types.js';

// =============================================================================
// tmux Session Manager
// Handles spawning and managing tmux sessions with worker panes
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
 * Check if a tmux session exists
 */
export function sessionExists(sessionName: string): boolean {
  try {
    execSync(`tmux has-session -t ${sessionName} 2>/dev/null`, { stdio: 'pipe' });
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
 * Create a new tmux session with the swarm layout
 * Layout:
 * ┌─────────────────────────────────────────────────┐
 * │ COMMANDER (status/control)                       │
 * ├────────────────────┬────────────────────────────┤
 * │ Worker 1           │ Worker 2                    │
 * ├────────────────────┼────────────────────────────┤
 * │ Worker 3           │ Validator                   │
 * └────────────────────┴────────────────────────────┘
 */
export function createSwarmSession(config: SwarmConfig): {
  sessionName: string;
  workers: SwarmWorker[];
  commanderPaneId: string;
  validatorPaneId: string;
} {
  const sessionName = generateSessionName();
  const workers: SwarmWorker[] = [];

  // Create session with commander pane (first window)
  execSync(
    `tmux new-session -d -s ${sessionName} -n main -x 200 -y 50`,
    { cwd: config.workingDirectory }
  );

  // Set pane border format to show names
  execSync(`tmux set-option -t ${sessionName} pane-border-format "#{pane_index}: #{pane_title}"`);
  execSync(`tmux set-option -t ${sessionName} pane-border-status top`);

  // Get commander pane ID
  const commanderPaneId = execSync(
    `tmux display-message -t ${sessionName} -p '#{pane_id}'`,
    { encoding: 'utf8' }
  ).trim();

  // Name the commander pane
  execSync(`tmux select-pane -t ${sessionName}:0.0 -T "Commander"`);

  // Split horizontally for validator (bottom right)
  execSync(`tmux split-window -t ${sessionName}:0 -h -p 50`);
  const validatorPaneId = execSync(
    `tmux display-message -t ${sessionName}:0.1 -p '#{pane_id}'`,
    { encoding: 'utf8' }
  ).trim();
  execSync(`tmux select-pane -t ${sessionName}:0.1 -T "Validator"`);

  // Create worker panes
  const workerCount = Math.min(config.workerCount, 8); // Cap at 8 workers

  for (let i = 0; i < workerCount; i++) {
    // Alternate between splitting left and right panes
    const targetPane = i % 2 === 0 ? 0 : 1;
    execSync(`tmux split-window -t ${sessionName}:0.${targetPane} -v -p ${Math.floor(100 / (Math.ceil(workerCount / 2) + 1))}`);

    const paneId = execSync(
      `tmux display-message -t ${sessionName}:0 -p '#{pane_id}'`,
      { encoding: 'utf8' }
    ).trim();

    const workerId = `worker-${i + 1}`;
    execSync(`tmux select-pane -t ${paneId} -T "${workerId}"`);

    workers.push({
      id: workerId,
      name: `Worker ${i + 1}`,
      status: 'idle',
      paneId,
      tasksCompleted: 0,
      lastActivity: Date.now(),
    });
  }

  // Re-arrange to tiled layout for better visibility
  execSync(`tmux select-layout -t ${sessionName}:0 tiled`);

  // Select commander pane
  execSync(`tmux select-pane -t ${commanderPaneId}`);

  return { sessionName, workers, commanderPaneId, validatorPaneId };
}

/**
 * Send a command to a specific pane
 */
export function sendToPane(sessionName: string, paneId: string, command: string): void {
  // Escape special characters for tmux
  const escaped = command.replace(/'/g, "'\\''");
  execSync(`tmux send-keys -t ${paneId} '${escaped}' Enter`);
}

/**
 * Start a Wilson worker in a pane
 */
export function startWorkerInPane(
  sessionName: string,
  paneId: string,
  workerId: string,
  workingDirectory: string
): void {
  // Start Wilson in worker mode
  const command = `cd "${workingDirectory}" && wilson --worker ${workerId}`;
  sendToPane(sessionName, paneId, command);
}

/**
 * Start the validator in a pane
 */
export function startValidatorInPane(
  sessionName: string,
  paneId: string,
  workingDirectory: string
): void {
  const command = `cd "${workingDirectory}" && wilson --validator`;
  sendToPane(sessionName, paneId, command);
}

/**
 * Start the commander view in a pane
 */
export function startCommanderInPane(
  sessionName: string,
  paneId: string,
  workingDirectory: string,
  goal: string
): void {
  // Commander runs the swarm monitor
  const escapedGoal = goal.replace(/"/g, '\\"');
  const command = `cd "${workingDirectory}" && wilson --swarm-monitor "${escapedGoal}"`;
  sendToPane(sessionName, paneId, command);
}

/**
 * Attach to a tmux session
 */
export function attachSession(sessionName: string): void {
  // This will replace the current process
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
 * Get pane contents (for debugging)
 */
export function getPaneContents(paneId: string, lines = 50): string {
  try {
    return execSync(`tmux capture-pane -t ${paneId} -p -S -${lines}`, { encoding: 'utf8' });
  } catch {
    return '';
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

/**
 * Focus a specific pane
 */
export function focusPane(sessionName: string, paneId: string): void {
  execSync(`tmux select-pane -t ${paneId}`);
}

/**
 * Resize the commander pane (top row)
 */
export function resizeCommanderPane(sessionName: string, height: number): void {
  try {
    execSync(`tmux resize-pane -t ${sessionName}:0.0 -y ${height}`);
  } catch {
    // Ignore resize errors
  }
}

// =============================================================================
// High-level Swarm Operations
// =============================================================================

/**
 * Spawn a complete swarm
 */
export function spawnSwarm(config: SwarmConfig): SwarmState {
  if (!isTmuxAvailable()) {
    throw new Error('tmux is not installed. Install it with: brew install tmux');
  }

  // Create the session
  const { sessionName, workers, commanderPaneId, validatorPaneId } = createSwarmSession(config);

  // Initialize swarm state
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
 * Launch all workers and validator
 */
export function launchSwarmProcesses(state: SwarmState): void {
  // Start workers
  for (const worker of state.workers) {
    startWorkerInPane(
      state.tmuxSession,
      worker.paneId,
      worker.id,
      state.workingDirectory
    );
  }

  // Find validator pane (it's the one not assigned to a worker)
  const workerPaneIds = new Set(state.workers.map(w => w.paneId));

  // Get all panes
  const panes = execSync(
    `tmux list-panes -t ${state.tmuxSession}:0 -F "#{pane_id}"`,
    { encoding: 'utf8' }
  ).trim().split('\n');

  // Find commander and validator panes (first two that aren't workers)
  const nonWorkerPanes = panes.filter(p => !workerPaneIds.has(p));

  if (nonWorkerPanes.length >= 2) {
    const [commanderPaneId, validatorPaneId] = nonWorkerPanes;

    // Start commander monitor
    startCommanderInPane(
      state.tmuxSession,
      commanderPaneId,
      state.workingDirectory,
      state.goal
    );

    // Start validator
    startValidatorInPane(
      state.tmuxSession,
      validatorPaneId,
      state.workingDirectory
    );
  }
}

/**
 * Shutdown the swarm gracefully
 */
export async function shutdownSwarm(state: SwarmState): Promise<void> {
  // Send interrupt to all panes first
  for (const worker of state.workers) {
    interruptPane(worker.paneId);
  }

  // Wait a moment for graceful shutdown
  await new Promise(resolve => setTimeout(resolve, 1000));

  // Kill the session
  killSession(state.tmuxSession);
}
