// =============================================================================
// Swarm Types - Multi-agent orchestration system
// =============================================================================

export type TaskStatus = 'pending' | 'in_progress' | 'completed' | 'failed' | 'validating';
export type WorkerStatus = 'idle' | 'working' | 'waiting' | 'completed' | 'failed';
export type SwarmStatus = 'initializing' | 'running' | 'paused' | 'completed' | 'failed';

/**
 * A single task in the swarm queue
 */
export interface SwarmTask {
  id: string;
  description: string;
  status: TaskStatus;
  workerId?: string;
  priority: number;
  dependencies: string[]; // Task IDs this depends on
  result?: TaskResult;
  createdAt: number;
  startedAt?: number;
  completedAt?: number;
  retryCount: number;
  maxRetries: number;
}

/**
 * Result of a completed task
 */
export interface TaskResult {
  success: boolean;
  output?: string;
  error?: string;
  filesCreated?: string[];
  filesModified?: string[];
  validationPassed?: boolean;
  validationNotes?: string;
}

/**
 * A worker instance running in a tmux pane
 */
export interface SwarmWorker {
  id: string;
  name: string;
  status: WorkerStatus;
  paneId: string;
  currentTaskId?: string;
  tasksCompleted: number;
  lastActivity: number;
  specialty?: string; // e.g., 'backend', 'frontend', 'testing'
}

/**
 * The validator agent
 */
export interface SwarmValidator {
  status: 'idle' | 'validating' | 'blocked';
  currentTaskId?: string;
  validationsCompleted: number;
  validationsPassed: number;
  validationsFailed: number;
}

/**
 * Overall swarm state
 */
export interface SwarmState {
  id: string;
  goal: string;
  status: SwarmStatus;
  workers: SwarmWorker[];
  validator: SwarmValidator;
  goalQueue: SwarmTask[];
  completionQueue: SwarmTask[];
  completedTasks: SwarmTask[];
  failedTasks: SwarmTask[];
  progress: number; // 0-100
  createdAt: number;
  startedAt?: number;
  completedAt?: number;
  tmuxSession: string;
  workingDirectory: string;
}

/**
 * Message between commander and workers
 */
export interface SwarmMessage {
  type: 'task_assigned' | 'task_completed' | 'task_failed' | 'validation_result' | 'status_update' | 'shutdown';
  from: string; // 'commander' | worker id | 'validator'
  to: string; // worker id | 'commander' | 'all'
  payload: unknown;
  timestamp: number;
}

/**
 * Configuration for spawning a swarm
 */
export interface SwarmConfig {
  goal: string;
  workerCount: number;
  workingDirectory: string;
  accessToken: string;
  storeId: string;
  maxRetries?: number;
  validationEnabled?: boolean;
}

/**
 * IPC file structure for coordination
 */
export interface SwarmIPC {
  goalQueue: string;      // .wilson-swarm/goal-queue.jsonl
  completionQueue: string; // .wilson-swarm/completion-queue.jsonl
  state: string;          // .wilson-swarm/state.json
  messages: string;       // .wilson-swarm/messages.jsonl
  lock: string;           // .wilson-swarm/lock
}
