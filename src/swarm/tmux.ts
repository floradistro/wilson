import { execSync } from 'child_process';
import type { SwarmConfig, SwarmWorker, SwarmState } from './types.js';

// =============================================================================
// tmux Session Manager
// Creates a beautiful grid layout with Commander + Workers
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
 * Create a swarm with Commander + 2 Workers
 * Layout (3 panes in a nice arrangement):
 *
 * ┌─────────────────────────────────────────────────┐
 * │              COMMANDER (red border)              │
 * │         Main orchestrator - your view           │
 * ├────────────────────────┬────────────────────────┤
 * │      Worker 1          │      Worker 2          │
 * │   (green border)       │   (green border)       │
 * └────────────────────────┴────────────────────────┘
 */
export function createSwarmSession(config: SwarmConfig): {
  sessionName: string;
  workers: SwarmWorker[];
  commanderPaneId: string;
  validatorPaneId: string;
} {
  const sessionName = generateSessionName();
  const workers: SwarmWorker[] = [];

  // Create session - first pane is Commander
  execSync(
    `tmux new-session -d -s ${sessionName} -n swarm`,
    { cwd: config.workingDirectory }
  );

  // Get Commander pane ID
  const commanderPane = execSync(
    `tmux display-message -t ${sessionName}:0.0 -p '#{pane_id}'`,
    { encoding: 'utf8' }
  ).trim();

  // Set Commander pane title
  execSync(`tmux select-pane -t ${commanderPane} -T "COMMANDER"`);

  // Split vertically - bottom half for workers (Commander gets top 40%)
  execSync(`tmux split-window -t ${sessionName}:0.0 -v -l 60%`);

  // Get Worker 1 pane
  const worker1Pane = execSync(
    `tmux display-message -t ${sessionName}:0.1 -p '#{pane_id}'`,
    { encoding: 'utf8' }
  ).trim();
  execSync(`tmux select-pane -t ${worker1Pane} -T "Worker 1"`);

  // Split the bottom half horizontally for Worker 2
  execSync(`tmux split-window -t ${worker1Pane} -h -l 50%`);

  // Get Worker 2 pane
  const worker2Pane = execSync(
    `tmux display-message -t ${sessionName}:0.2 -p '#{pane_id}'`,
    { encoding: 'utf8' }
  ).trim();
  execSync(`tmux select-pane -t ${worker2Pane} -T "Worker 2"`);

  // Configure pane borders and colors
  // Commander gets RED border, workers get GREEN
  execSync(`tmux set-option -t ${sessionName} pane-border-format " #{?#{==:#{pane_title},COMMANDER},#[fg=red bold],#[fg=green]}#T "`);
  execSync(`tmux set-option -t ${sessionName} pane-border-status top`);
  execSync(`tmux set-option -t ${sessionName} pane-border-style "fg=colour240"`);
  execSync(`tmux set-option -t ${sessionName} pane-active-border-style "fg=brightcyan,bold"`);

  // Enable mouse for easy pane switching
  execSync(`tmux set-option -t ${sessionName} mouse on`);

  // Disable status bar for cleaner look
  execSync(`tmux set-option -t ${sessionName} status off`);

  // Add workers to list
  workers.push({
    id: 'worker-1',
    name: 'Worker 1',
    status: 'idle',
    paneId: worker1Pane,
    tasksCompleted: 0,
    lastActivity: Date.now(),
  });

  workers.push({
    id: 'worker-2',
    name: 'Worker 2',
    status: 'idle',
    paneId: worker2Pane,
    tasksCompleted: 0,
    lastActivity: Date.now(),
  });

  // Select Commander pane initially
  execSync(`tmux select-pane -t ${commanderPane}`);

  return {
    sessionName,
    workers,
    commanderPaneId: commanderPane,
    validatorPaneId: commanderPane, // Not used
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
 */
export function startWorkerInPane(
  sessionName: string,
  paneId: string,
  workerId: string,
  workingDirectory: string,
  task: string
): void {
  // Write task to a temp file to avoid shell escaping issues
  const taskFile = `/tmp/wilson-task-${workerId}-${Date.now()}.txt`;
  const fs = require('fs');
  fs.writeFileSync(taskFile, task);

  // Use cat to read the task and pipe to wilson, or use xargs
  // Simpler: just use a heredoc-style approach
  const command = `cd "${workingDirectory}" && wilson --dangerously-skip-permissions "$(cat ${taskFile})" && rm ${taskFile}`;
  sendToPane(sessionName, paneId, command);
}

/**
 * Start the Commander Wilson (main orchestrator)
 * Commander gets a special prompt that explains the swarm context
 */
export function startCommanderInPane(
  sessionName: string,
  paneId: string,
  workingDirectory: string,
  goal: string,
  tasks: string[]
): void {
  // Write swarm context to a file for the commander
  const contextFile = `/tmp/wilson-commander-${Date.now()}.txt`;
  const fs = require('fs');

  const context = `You are the COMMANDER of a Wilson swarm. You are orchestrating ${tasks.length} workers.

GOAL: ${goal}

WORKER TASKS:
${tasks.map((t, i) => `- Worker ${i + 1}: ${t}`).join('\n')}

Your workers are already executing their tasks in the panes below you.
You can see their progress. Your job is to:
1. Monitor overall progress
2. Help coordinate if workers need guidance
3. Integrate results when workers complete
4. Answer any questions about the swarm

The workers are working autonomously. You can interact with the user to provide status updates.`;

  fs.writeFileSync(contextFile, context);

  // Start Wilson with the swarm context as initial message
  const command = `cd "${workingDirectory}" && wilson "$(cat ${contextFile})" && rm ${contextFile}`;
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
 * Spawn a swarm - creates tmux session with Commander + Workers
 */
export function spawnSwarm(config: SwarmConfig): SwarmState {
  if (!isTmuxAvailable()) {
    throw new Error('tmux is not installed. Install it with: brew install tmux');
  }

  const { sessionName, workers, commanderPaneId } = createSwarmSession(config);

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

  // Store commander pane ID in state for later use
  (state as any).commanderPaneId = commanderPaneId;

  return state;
}

/**
 * Launch Commander and Workers
 */
export function launchSwarmProcesses(state: SwarmState, tasks: string[]): void {
  const commanderPaneId = (state as any).commanderPaneId;

  // Start Workers FIRST so they begin working
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

  // Small delay, then start Commander with full context
  setTimeout(() => {
    if (commanderPaneId) {
      startCommanderInPane(
        state.tmuxSession,
        commanderPaneId,
        state.workingDirectory,
        state.goal,
        tasks
      );
    }
  }, 500);
}

/**
 * Shutdown the swarm gracefully
 */
export async function shutdownSwarm(state: SwarmState): Promise<void> {
  // Interrupt all panes
  const commanderPaneId = (state as any).commanderPaneId;
  if (commanderPaneId) {
    interruptPane(commanderPaneId);
  }
  for (const worker of state.workers) {
    interruptPane(worker.paneId);
  }

  await new Promise(resolve => setTimeout(resolve, 1000));
  killSession(state.tmuxSession);
}
