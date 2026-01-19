import { existsSync, readFileSync, writeFileSync, appendFileSync, mkdirSync, unlinkSync } from 'fs';
import { join, dirname } from 'path';
import type { SwarmTask, SwarmState, SwarmMessage, SwarmIPC } from './types.js';

// =============================================================================
// File-based Queue System
// Uses JSONL files for queues, JSON for state, with file locking
// =============================================================================

const SWARM_DIR = '.wilson-swarm';
const LOCK_TIMEOUT = 5000; // 5 second lock timeout
const LOCK_RETRY_INTERVAL = 50; // 50ms between lock retries

/**
 * Get IPC paths for a working directory
 */
export function getIPCPaths(workingDirectory: string): SwarmIPC {
  const base = join(workingDirectory, SWARM_DIR);
  return {
    goalQueue: join(base, 'goal-queue.jsonl'),
    completionQueue: join(base, 'completion-queue.jsonl'),
    state: join(base, 'state.json'),
    messages: join(base, 'messages.jsonl'),
    lock: join(base, 'lock'),
  };
}

/**
 * Initialize swarm directory structure
 */
export function initSwarmDir(workingDirectory: string): SwarmIPC {
  const paths = getIPCPaths(workingDirectory);
  const dir = dirname(paths.state);

  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  // Initialize empty files
  if (!existsSync(paths.goalQueue)) writeFileSync(paths.goalQueue, '');
  if (!existsSync(paths.completionQueue)) writeFileSync(paths.completionQueue, '');
  if (!existsSync(paths.messages)) writeFileSync(paths.messages, '');

  return paths;
}

/**
 * Clean up swarm directory
 */
export function cleanupSwarmDir(workingDirectory: string): void {
  const paths = getIPCPaths(workingDirectory);
  const dir = dirname(paths.state);

  try {
    if (existsSync(paths.goalQueue)) unlinkSync(paths.goalQueue);
    if (existsSync(paths.completionQueue)) unlinkSync(paths.completionQueue);
    if (existsSync(paths.state)) unlinkSync(paths.state);
    if (existsSync(paths.messages)) unlinkSync(paths.messages);
    if (existsSync(paths.lock)) unlinkSync(paths.lock);
    // Remove directory if empty
    if (existsSync(dir)) {
      const fs = require('fs');
      fs.rmdirSync(dir);
    }
  } catch {
    // Ignore cleanup errors
  }
}

// =============================================================================
// File Locking (simple advisory lock using a lock file)
// =============================================================================

/**
 * Acquire a lock with timeout
 */
async function acquireLock(lockPath: string): Promise<void> {
  const startTime = Date.now();

  while (Date.now() - startTime < LOCK_TIMEOUT) {
    try {
      // Try to create lock file exclusively
      writeFileSync(lockPath, String(process.pid), { flag: 'wx' });
      return;
    } catch (err: any) {
      if (err.code === 'EEXIST') {
        // Check if lock is stale (owner process died)
        try {
          const pid = parseInt(readFileSync(lockPath, 'utf8'));
          try {
            // Check if process exists (signal 0 doesn't actually send a signal)
            process.kill(pid, 0);
          } catch {
            // Process doesn't exist, lock is stale - remove it
            unlinkSync(lockPath);
            continue;
          }
        } catch {
          // Can't read lock file, try again
        }

        // Wait and retry
        await new Promise(resolve => setTimeout(resolve, LOCK_RETRY_INTERVAL));
      } else {
        throw err;
      }
    }
  }

  throw new Error('Failed to acquire lock: timeout');
}

/**
 * Release a lock
 */
function releaseLock(lockPath: string): void {
  try {
    unlinkSync(lockPath);
  } catch {
    // Ignore - lock may have already been released
  }
}

/**
 * Execute a function with lock held
 */
async function withLock<T>(lockPath: string, fn: () => T | Promise<T>): Promise<T> {
  await acquireLock(lockPath);
  try {
    return await fn();
  } finally {
    releaseLock(lockPath);
  }
}

// =============================================================================
// Queue Operations
// =============================================================================

/**
 * Read all items from a JSONL queue file
 */
function readQueue<T>(filePath: string): T[] {
  if (!existsSync(filePath)) return [];

  const content = readFileSync(filePath, 'utf8').trim();
  if (!content) return [];

  return content.split('\n').filter(line => line.trim()).map(line => JSON.parse(line));
}

/**
 * Write all items to a JSONL queue file (overwrites)
 */
function writeQueue<T>(filePath: string, items: T[]): void {
  const content = items.map(item => JSON.stringify(item)).join('\n');
  writeFileSync(filePath, content ? content + '\n' : '');
}

/**
 * Append an item to a JSONL queue file
 */
function appendToQueue<T>(filePath: string, item: T): void {
  appendFileSync(filePath, JSON.stringify(item) + '\n');
}

/**
 * Pop the first item from a queue (atomic)
 */
export async function popFromGoalQueue(paths: SwarmIPC): Promise<SwarmTask | null> {
  return withLock(paths.lock, () => {
    const items = readQueue<SwarmTask>(paths.goalQueue);
    if (items.length === 0) return null;

    // Find highest priority pending task with satisfied dependencies
    const state = readState(paths);
    const completedIds = new Set(state?.completedTasks.map(t => t.id) || []);

    const availableIndex = items.findIndex(task =>
      task.status === 'pending' &&
      task.dependencies.every(depId => completedIds.has(depId))
    );

    if (availableIndex === -1) return null;

    const task = items[availableIndex];
    task.status = 'in_progress';
    task.startedAt = Date.now();
    items[availableIndex] = task;
    writeQueue(paths.goalQueue, items);

    return task;
  });
}

/**
 * Push a task to the goal queue
 */
export async function pushToGoalQueue(paths: SwarmIPC, task: SwarmTask): Promise<void> {
  return withLock(paths.lock, () => {
    appendToQueue(paths.goalQueue, task);
  });
}

/**
 * Push multiple tasks to the goal queue
 */
export async function pushManyToGoalQueue(paths: SwarmIPC, tasks: SwarmTask[]): Promise<void> {
  return withLock(paths.lock, () => {
    for (const task of tasks) {
      appendToQueue(paths.goalQueue, task);
    }
  });
}

/**
 * Push a completed task to the completion queue
 */
export async function pushToCompletionQueue(paths: SwarmIPC, task: SwarmTask): Promise<void> {
  return withLock(paths.lock, () => {
    appendToQueue(paths.completionQueue, task);
  });
}

/**
 * Pop from completion queue (for validator)
 */
export async function popFromCompletionQueue(paths: SwarmIPC): Promise<SwarmTask | null> {
  return withLock(paths.lock, () => {
    const items = readQueue<SwarmTask>(paths.completionQueue);
    if (items.length === 0) return null;

    const task = items.shift()!;
    writeQueue(paths.completionQueue, items);

    return task;
  });
}

// =============================================================================
// State Operations
// =============================================================================

/**
 * Read swarm state
 */
export function readState(paths: SwarmIPC): SwarmState | null {
  if (!existsSync(paths.state)) return null;

  try {
    return JSON.parse(readFileSync(paths.state, 'utf8'));
  } catch {
    return null;
  }
}

/**
 * Write swarm state (atomic)
 */
export async function writeState(paths: SwarmIPC, state: SwarmState): Promise<void> {
  return withLock(paths.lock, () => {
    writeFileSync(paths.state, JSON.stringify(state, null, 2));
  });
}

/**
 * Update swarm state atomically
 */
export async function updateState(
  paths: SwarmIPC,
  updater: (state: SwarmState) => SwarmState
): Promise<SwarmState> {
  return withLock(paths.lock, () => {
    const state = readState(paths);
    if (!state) throw new Error('Swarm state not found');

    const newState = updater(state);
    writeFileSync(paths.state, JSON.stringify(newState, null, 2));
    return newState;
  });
}

// =============================================================================
// Message Operations
// =============================================================================

/**
 * Send a message
 */
export async function sendMessage(paths: SwarmIPC, message: Omit<SwarmMessage, 'timestamp'>): Promise<void> {
  const fullMessage: SwarmMessage = {
    ...message,
    timestamp: Date.now(),
  };

  return withLock(paths.lock, () => {
    appendToQueue(paths.messages, fullMessage);
  });
}

/**
 * Read messages for a specific recipient
 */
export function readMessagesFor(paths: SwarmIPC, recipient: string): SwarmMessage[] {
  const all = readQueue<SwarmMessage>(paths.messages);
  return all.filter(m => m.to === recipient || m.to === 'all');
}

/**
 * Clear processed messages
 */
export async function clearMessagesFor(paths: SwarmIPC, recipient: string): Promise<void> {
  return withLock(paths.lock, () => {
    const all = readQueue<SwarmMessage>(paths.messages);
    const remaining = all.filter(m => m.to !== recipient && m.to !== 'all');
    writeQueue(paths.messages, remaining);
  });
}

// =============================================================================
// Progress Calculation
// =============================================================================

/**
 * Calculate overall progress percentage
 */
export function calculateProgress(state: SwarmState): number {
  const total = state.goalQueue.length + state.completionQueue.length +
                state.completedTasks.length + state.failedTasks.length;

  if (total === 0) return 0;

  const done = state.completedTasks.length;
  return Math.round((done / total) * 100);
}

/**
 * Check if swarm is complete
 */
export function isSwarmComplete(state: SwarmState): boolean {
  const pendingOrInProgress = state.goalQueue.filter(
    t => t.status === 'pending' || t.status === 'in_progress'
  );

  return pendingOrInProgress.length === 0 && state.completionQueue.length === 0;
}
