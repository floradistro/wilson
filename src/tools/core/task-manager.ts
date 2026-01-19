/**
 * Wilson Task Manager
 *
 * Unified management for:
 * - Background processes (dev servers, builds, tests)
 * - Long-running commands
 * - Process monitoring and health checks
 *
 * Based on Claude Code's background task patterns
 */

import { spawn, ChildProcess, execSync } from 'child_process';
import { EventEmitter } from 'events';

// =============================================================================
// Types
// =============================================================================

export interface TaskInfo {
  id: string;
  name: string;
  command: string;
  args: string[];
  cwd: string;
  pid?: number;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'killed';
  startTime: number;
  endTime?: number;
  exitCode?: number;
  output: string[];
  errors: string[];
  isBackground: boolean;
}

export interface TaskOptions {
  name?: string;
  cwd?: string;
  env?: Record<string, string>;
  timeout?: number;
  background?: boolean;
  onOutput?: (data: string) => void;
  onError?: (data: string) => void;
  onExit?: (code: number | null) => void;
}

// =============================================================================
// Task Registry
// =============================================================================

class TaskRegistry extends EventEmitter {
  private tasks: Map<string, TaskInfo> = new Map();
  private processes: Map<string, ChildProcess> = new Map();
  private idCounter = 0;

  generateId(): string {
    return `task_${++this.idCounter}_${Date.now().toString(36)}`;
  }

  register(task: TaskInfo): void {
    this.tasks.set(task.id, task);
    this.emit('task:registered', task);
  }

  get(id: string): TaskInfo | undefined {
    return this.tasks.get(id);
  }

  getByPid(pid: number): TaskInfo | undefined {
    for (const task of Array.from(this.tasks.values())) {
      if (task.pid === pid) return task;
    }
    return undefined;
  }

  getByName(name: string): TaskInfo | undefined {
    for (const task of Array.from(this.tasks.values())) {
      if (task.name === name) return task;
    }
    return undefined;
  }

  getRunning(): TaskInfo[] {
    return Array.from(this.tasks.values()).filter(t => t.status === 'running');
  }

  getAll(): TaskInfo[] {
    return Array.from(this.tasks.values());
  }

  update(id: string, updates: Partial<TaskInfo>): void {
    const task = this.tasks.get(id);
    if (task) {
      Object.assign(task, updates);
      this.emit('task:updated', task);
    }
  }

  setProcess(id: string, process: ChildProcess): void {
    this.processes.set(id, process);
  }

  getProcess(id: string): ChildProcess | undefined {
    return this.processes.get(id);
  }

  remove(id: string): void {
    this.tasks.delete(id);
    this.processes.delete(id);
    this.emit('task:removed', id);
  }

  cleanup(): void {
    // Remove completed tasks older than 5 minutes
    const cutoff = Date.now() - 5 * 60 * 1000;
    for (const [id, task] of Array.from(this.tasks.entries())) {
      if (task.status !== 'running' && task.endTime && task.endTime < cutoff) {
        this.remove(id);
      }
    }
  }
}

export const taskRegistry = new TaskRegistry();

// =============================================================================
// Task Execution
// =============================================================================

export async function runTask(
  command: string,
  args: string[] = [],
  options: TaskOptions = {}
): Promise<TaskInfo> {
  const id = taskRegistry.generateId();
  const task: TaskInfo = {
    id,
    name: options.name || `${command} ${args.join(' ')}`.trim().slice(0, 50),
    command,
    args,
    cwd: options.cwd || process.cwd(),
    status: 'pending',
    startTime: Date.now(),
    output: [],
    errors: [],
    isBackground: options.background || false,
  };

  taskRegistry.register(task);

  return new Promise((resolve, reject) => {
    const proc = spawn(command, args, {
      cwd: task.cwd,
      env: { ...process.env, ...options.env },
      shell: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    task.pid = proc.pid;
    task.status = 'running';
    taskRegistry.setProcess(id, proc);
    taskRegistry.update(id, { pid: proc.pid, status: 'running' });

    const outputBuffer: string[] = [];
    const errorBuffer: string[] = [];

    proc.stdout?.on('data', (data: Buffer) => {
      const str = data.toString();
      outputBuffer.push(str);
      task.output.push(str);
      options.onOutput?.(str);
    });

    proc.stderr?.on('data', (data: Buffer) => {
      const str = data.toString();
      errorBuffer.push(str);
      task.errors.push(str);
      options.onError?.(str);
    });

    // Handle timeout
    let timeoutId: NodeJS.Timeout | undefined;
    if (options.timeout) {
      timeoutId = setTimeout(() => {
        proc.kill('SIGTERM');
        task.status = 'killed';
        taskRegistry.update(id, { status: 'killed', endTime: Date.now() });
      }, options.timeout);
    }

    proc.on('close', (code) => {
      if (timeoutId) clearTimeout(timeoutId);

      task.exitCode = code ?? undefined;
      task.endTime = Date.now();
      task.status = code === 0 ? 'completed' : 'failed';

      taskRegistry.update(id, {
        exitCode: code ?? undefined,
        endTime: task.endTime,
        status: task.status,
      });

      options.onExit?.(code);
      resolve(taskRegistry.get(id)!);
    });

    proc.on('error', (err) => {
      if (timeoutId) clearTimeout(timeoutId);

      task.status = 'failed';
      task.endTime = Date.now();
      task.errors.push(err.message);

      taskRegistry.update(id, {
        status: 'failed',
        endTime: task.endTime,
      });

      // Still resolve with the task info
      resolve(taskRegistry.get(id)!);
    });

    // For background tasks, resolve immediately after starting
    if (options.background) {
      setTimeout(() => resolve(taskRegistry.get(id)!), 100);
    }
  });
}

// =============================================================================
// Task Control
// =============================================================================

export function killTask(id: string, signal: NodeJS.Signals = 'SIGTERM'): boolean {
  const proc = taskRegistry.getProcess(id);
  if (proc && proc.pid) {
    try {
      process.kill(proc.pid, signal);
      taskRegistry.update(id, { status: 'killed', endTime: Date.now() });
      return true;
    } catch {
      return false;
    }
  }
  return false;
}

export function killTaskByName(name: string): boolean {
  const task = taskRegistry.getByName(name);
  if (task) {
    return killTask(task.id);
  }
  return false;
}

export function killTaskByPid(pid: number): boolean {
  const task = taskRegistry.getByPid(pid);
  if (task) {
    return killTask(task.id);
  }
  // Try direct kill
  try {
    process.kill(pid, 'SIGTERM');
    return true;
  } catch {
    return false;
  }
}

// =============================================================================
// Task Output
// =============================================================================

export function getTaskOutput(id: string, tail?: number): string[] {
  const task = taskRegistry.get(id);
  if (!task) return [];

  const output = task.output;
  if (tail) {
    return output.slice(-tail);
  }
  return output;
}

export function getTaskErrors(id: string): string[] {
  const task = taskRegistry.get(id);
  return task?.errors || [];
}

// =============================================================================
// System Process Discovery
// =============================================================================

export interface SystemProcess {
  pid: number;
  command: string;
  cpu: string;
  memory: string;
  cwd?: string;
  port?: number;
}

export function discoverProcesses(filter?: string): SystemProcess[] {
  try {
    const filterPattern = filter || 'node|bun|next|vite|npm|yarn|python|ruby';
    const cmd = `ps aux | grep -E "${filterPattern}" | grep -v grep`;
    const output = execSync(cmd, { encoding: 'utf8', timeout: 5000 });

    const processes: SystemProcess[] = [];

    for (const line of output.trim().split('\n')) {
      if (!line.trim()) continue;

      const parts = line.trim().split(/\s+/);
      if (parts.length < 11) continue;

      const pid = parseInt(parts[1], 10);
      const cpu = parts[2];
      const memory = parts[3];
      const command = parts.slice(10).join(' ');

      if (isNaN(pid)) continue;

      const proc: SystemProcess = { pid, command, cpu, memory };

      // Try to get working directory
      try {
        const cwdOutput = execSync(`lsof -p ${pid} 2>/dev/null | grep cwd | head -1`, {
          encoding: 'utf8',
          timeout: 2000,
        });
        const cwdMatch = cwdOutput.match(/\s(\/[^\s]+)$/);
        if (cwdMatch) proc.cwd = cwdMatch[1];
      } catch {}

      // Try to get port
      try {
        const portOutput = execSync(
          `lsof -i -P -n -p ${pid} 2>/dev/null | grep LISTEN | head -1`,
          { encoding: 'utf8', timeout: 2000 }
        );
        const portMatch = portOutput.match(/:(\d+)\s+\(LISTEN\)/);
        if (portMatch) proc.port = parseInt(portMatch[1], 10);
      } catch {}

      processes.push(proc);
    }

    return processes;
  } catch {
    return [];
  }
}

export function getPortsInUse(): Array<{ port: number; pid: number; process: string }> {
  try {
    const output = execSync('lsof -i -P -n | grep LISTEN', {
      encoding: 'utf8',
      timeout: 5000,
    });

    const ports: Array<{ port: number; pid: number; process: string }> = [];
    const seen = new Set<number>();

    for (const line of output.trim().split('\n')) {
      const parts = line.trim().split(/\s+/);
      if (parts.length < 9) continue;

      const process = parts[0];
      const pid = parseInt(parts[1], 10);
      const address = parts[8];

      const portMatch = address.match(/:(\d+)$/);
      if (portMatch) {
        const port = parseInt(portMatch[1], 10);
        if (!seen.has(port)) {
          seen.add(port);
          ports.push({ port, pid, process });
        }
      }
    }

    return ports.sort((a, b) => a.port - b.port);
  } catch {
    return [];
  }
}

// =============================================================================
// Health Checks
// =============================================================================

export function checkTaskHealth(id: string): {
  alive: boolean;
  responding: boolean;
  issues: string[];
} {
  const task = taskRegistry.get(id);
  if (!task) {
    return { alive: false, responding: false, issues: ['Task not found'] };
  }

  if (task.status !== 'running') {
    return { alive: false, responding: false, issues: [`Task status: ${task.status}`] };
  }

  const issues: string[] = [];

  // Check if process is still alive
  if (task.pid) {
    try {
      process.kill(task.pid, 0); // Signal 0 just checks existence
    } catch {
      issues.push('Process no longer running');
      return { alive: false, responding: false, issues };
    }
  }

  // Check for error patterns in recent output
  const recentOutput = task.output.slice(-10).join('\n');
  const recentErrors = task.errors.slice(-10).join('\n');

  if (/error|exception|fatal|crash/i.test(recentErrors)) {
    issues.push('Recent errors detected');
  }

  if (/EADDRINUSE/.test(recentErrors)) {
    issues.push('Port already in use');
  }

  return {
    alive: true,
    responding: issues.length === 0,
    issues,
  };
}

// =============================================================================
// Auto-cleanup
// =============================================================================

setInterval(() => {
  taskRegistry.cleanup();
}, 60000); // Every minute
