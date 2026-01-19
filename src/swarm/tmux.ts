import { execSync } from 'child_process';
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
 * Simple 2x2 grid layout for 4 workers:
 * ┌─────────────────┬─────────────────┐
 * │ Worker 1        │ Worker 2        │
 * ├─────────────────┼─────────────────┤
 * │ Worker 3        │ Worker 4        │
 * └─────────────────┴─────────────────┘
 */
export function createSwarmSession(config: SwarmConfig): {
  sessionName: string;
  workers: SwarmWorker[];
  commanderPaneId: string;
  validatorPaneId: string;
} {
  const sessionName = generateSessionName();
  const workers: SwarmWorker[] = [];
  const workerCount = Math.min(config.workerCount, 4); // Cap at 4 for clean layout

  // Create session - first pane becomes Worker 1
  execSync(
    `tmux new-session -d -s ${sessionName} -n main`,
    { cwd: config.workingDirectory }
  );

  // Set pane border format
  execSync(`tmux set-option -t ${sessionName} pane-border-format " #{pane_title} "`);
  execSync(`tmux set-option -t ${sessionName} pane-border-status top`);
  execSync(`tmux set-option -t ${sessionName} pane-border-style "fg=green"`);
  execSync(`tmux set-option -t ${sessionName} pane-active-border-style "fg=brightgreen,bold"`);

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

  // Split horizontally for Worker 2 (right side)
  execSync(`tmux split-window -t ${sessionName}:0.0 -h -p 50`);
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

  if (workerCount >= 3) {
    // Split Worker 1 vertically for Worker 3 (bottom left)
    execSync(`tmux split-window -t ${pane1} -v -p 50`);
    const pane3 = execSync(
      `tmux display-message -t ${sessionName}:0.2 -p '#{pane_id}'`,
      { encoding: 'utf8' }
    ).trim();
    execSync(`tmux select-pane -t ${pane3} -T "Worker 3"`);
    workers.push({
      id: 'worker-3',
      name: 'Worker 3',
      status: 'idle',
      paneId: pane3,
      tasksCompleted: 0,
      lastActivity: Date.now(),
    });
  }

  if (workerCount >= 4) {
    // Split Worker 2 vertically for Worker 4 (bottom right)
    execSync(`tmux split-window -t ${pane2} -v -p 50`);
    const pane4 = execSync(
      `tmux display-message -t ${sessionName}:0.3 -p '#{pane_id}'`,
      { encoding: 'utf8' }
    ).trim();
    execSync(`tmux select-pane -t ${pane4} -T "Worker 4"`);
    workers.push({
      id: 'worker-4',
      name: 'Worker 4',
      status: 'idle',
      paneId: pane4,
      tasksCompleted: 0,
      lastActivity: Date.now(),
    });
  }

  // Select first pane
  execSync(`tmux select-pane -t ${pane1}`);

  // Return empty commander/validator panes - we're not using them anymore
  // Each worker runs the full Wilson UI
  return {
    sessionName,
    workers,
    commanderPaneId: pane1, // Not really used
    validatorPaneId: pane1, // Not really used
  };
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
 * Start a Wilson worker in a pane - runs full Wilson UI with worker mode
 */
export function startWorkerInPane(
  sessionName: string,
  paneId: string,
  workerId: string,
  workingDirectory: string
): void {
  // Run Wilson in worker mode - this renders the full UI
  const command = `cd "${workingDirectory}" && wilson --worker ${workerId}`;
  sendToPane(sessionName, paneId, command);
}

/**
 * Start the validator in a pane (not used in new design)
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
 * Start the commander view in a pane (not used in new design)
 */
export function startCommanderInPane(
  sessionName: string,
  paneId: string,
  workingDirectory: string,
  goal: string
): void {
  const escapedGoal = goal.replace(/"/g, '\\"');
  const command = `cd "${workingDirectory}" && wilson --swarm-monitor "${escapedGoal}"`;
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

// =============================================================================
// High-level Swarm Operations
// =============================================================================

/**
 * Spawn a complete swarm - just creates tmux session with worker panes
 */
export function spawnSwarm(config: SwarmConfig): SwarmState {
  if (!isTmuxAvailable()) {
    throw new Error('tmux is not installed. Install it with: brew install tmux');
  }

  // Create the session
  const { sessionName, workers } = createSwarmSession(config);

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
 * Launch all workers - each runs full Wilson UI
 */
export function launchSwarmProcesses(state: SwarmState): void {
  // Start workers - each one runs Wilson with its task
  for (const worker of state.workers) {
    startWorkerInPane(
      state.tmuxSession,
      worker.paneId,
      worker.id,
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
