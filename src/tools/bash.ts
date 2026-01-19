import { spawn, type ChildProcess } from 'child_process';
import type { Tool, ToolResult } from '../types.js';
import { BashSchema } from './schemas.js';
import { checkDangerousCommand } from '../utils/safety.js';
import { getSupabaseEnv } from './env.js';

interface BashParams {
  command: string;
  cwd?: string;
  timeout?: number;
  description?: string;
  background?: boolean;
}

const MAX_TIMEOUT = 600000; // 10 minutes
const DEFAULT_TIMEOUT = 120000; // 2 minutes
const MAX_OUTPUT = 100000; // 100KB output limit
const BACKGROUND_STARTUP_WAIT = 2000; // Wait 2s to capture initial output

// Track background processes
interface BackgroundProcess {
  pid: number;
  command: string;
  startedAt: Date;
  output: string;
  child: ChildProcess;
}

const backgroundProcesses = new Map<number, BackgroundProcess>();

// Commands that run forever (servers, watchers, etc.)
const LONG_RUNNING_PATTERNS = [
  // Package manager dev/start commands
  /\bnpm\s+run\s+(dev|start|watch|serve)/i,
  /\byarn\s+(dev|start|watch|serve)/i,
  /\bpnpm\s+(dev|start|watch|serve)/i,
  /\bbun\s+(run\s+)?(dev|start|watch|serve)/i,
  /\bnpx\s+(serve|http-server|live-server|vite|next|nuxt)/i,
  // Framework CLIs
  /\bnext\s+dev/i,
  /\bnuxt\s+dev/i,
  /\bvite\b/i,
  /\bflask\s+run/i,
  /\buvicorn\b/i,
  /\bgunicorn\b/i,
  /\bdjango.*runserver/i,
  // Node tools
  /\bnodemon\b/i,
  /\btsc\s+(--watch|-w)/i,
  /\bts-node-dev\b/i,
  // Python servers
  /\bpython3?\s+-m\s+http\.server/i,
  /\bpython3?\s+-m\s+SimpleHTTPServer/i,
  // PHP/Ruby servers
  /\bphp\s+-S/i,
  /\bruby\s+-run/i,
  // Docker (might start servers)
  /\bdocker\s+(run|compose\s+up)/i,
  // Generic patterns
  /\btail\s+-[fF]/i,
  /http-server/i,
  /live-server/i,
];

function isLongRunning(command: string): boolean {
  return LONG_RUNNING_PATTERNS.some(p => p.test(command));
}

// Run a command in background and return immediately
function runInBackground(command: string, cwd: string): Promise<ToolResult> {
  return new Promise((resolve) => {
    // Inject Wilson/Supabase credentials into child process
    const supabaseEnv = getSupabaseEnv();

    const child = spawn('bash', ['-c', command], {
      cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: true,
      env: { ...process.env, ...supabaseEnv },
    });

    const pid = child.pid!;
    let output = '';

    const proc: BackgroundProcess = {
      pid,
      command,
      startedAt: new Date(),
      output: '',
      child,
    };
    backgroundProcesses.set(pid, proc);

    child.stdout?.on('data', (data: Buffer) => {
      output += data.toString();
      proc.output = output.slice(-10000); // Keep last 10KB
    });

    child.stderr?.on('data', (data: Buffer) => {
      output += data.toString();
      proc.output = output.slice(-10000);
    });

    child.on('close', () => {
      backgroundProcesses.delete(pid);
    });

    // Unref so process doesn't keep node alive
    child.unref();

    // Wait briefly to capture startup output
    setTimeout(() => {
      // Extract port from output if available
      const portMatch = output.match(/localhost:(\d+)|127\.0\.0\.1:(\d+)|port\s*(\d+)/i);
      const port = portMatch ? (portMatch[1] || portMatch[2] || portMatch[3]) : '3000';

      resolve({
        success: true,
        content: `Server is now running at http://localhost:${port} (PID: ${pid})

The development server started successfully in the background. The user can now open their browser to view the site.`,
        pid,
        // Mark this as a terminal action - no further tools needed
        _terminal: true,
      });
    }, BACKGROUND_STARTUP_WAIT);
  });
}

// Get output from background process
export function getBackgroundOutput(pid: number): string | null {
  const proc = backgroundProcesses.get(pid);
  return proc?.output || null;
}

// Kill background process
export function killBackgroundProcess(pid: number): boolean {
  const proc = backgroundProcesses.get(pid);
  if (proc) {
    try {
      proc.child.kill('SIGTERM');
      backgroundProcesses.delete(pid);
      return true;
    } catch {
      return false;
    }
  }
  return false;
}

// List background processes
export function listBackgroundProcesses(): Array<{ pid: number; command: string; startedAt: Date }> {
  return Array.from(backgroundProcesses.values()).map(p => ({
    pid: p.pid,
    command: p.command,
    startedAt: p.startedAt,
  }));
}

export const bashTool: Tool = {
  schema: BashSchema,

  async execute(params: Record<string, unknown>): Promise<ToolResult> {
    const {
      command,
      cwd = process.cwd(),
      timeout = DEFAULT_TIMEOUT,
      background = false,
    } = params as unknown as BashParams;

    if (!command) {
      return { success: false, error: 'Missing command' };
    }

    // Check for dangerous commands
    const dangerCheck = checkDangerousCommand(command);
    if (dangerCheck) {
      return {
        success: false,
        error: `Dangerous operation blocked: ${dangerCheck}. Use --dangerously-skip-permissions to override.`,
      };
    }

    // Auto-detect and run long-running commands in background
    if (background || isLongRunning(command)) {
      return runInBackground(command, cwd as string);
    }

    const actualTimeout = Math.min(timeout, MAX_TIMEOUT);

    return new Promise((resolve) => {
      let resolved = false;

      // Inject Wilson/Supabase credentials into child process
      const supabaseEnv = getSupabaseEnv();

      const child: ChildProcess = spawn('bash', ['-c', command], {
        cwd,
        stdio: ['pipe', 'pipe', 'pipe'],
        // Kill entire process group on termination
        detached: false,
        env: { ...process.env, ...supabaseEnv },
      });

      // Close stdin immediately to prevent commands waiting for input
      child.stdin?.end();

      let stdout = '';
      let stderr = '';
      let truncated = false;

      child.stdout?.on('data', (data: Buffer) => {
        if (stdout.length < MAX_OUTPUT) {
          stdout += data.toString();
          if (stdout.length > MAX_OUTPUT) {
            stdout = stdout.slice(0, MAX_OUTPUT);
            truncated = true;
          }
        }
      });

      child.stderr?.on('data', (data: Buffer) => {
        if (stderr.length < MAX_OUTPUT) {
          stderr += data.toString();
          if (stderr.length > MAX_OUTPUT) {
            stderr = stderr.slice(0, MAX_OUTPUT);
            truncated = true;
          }
        }
      });

      const finish = (success: boolean, content: string, error?: string) => {
        if (resolved) return;
        resolved = true;
        clearTimeout(timer);

        const suffix = truncated ? '\n...(output truncated)' : '';

        if (success) {
          resolve({ success: true, content: content + suffix });
        } else {
          resolve({ success: false, error: (error || content) + suffix });
        }
      };

      child.on('close', (code: number | null) => {
        if (code === 0) {
          finish(true, stdout || stderr || 'Command completed');
        } else {
          finish(false, '', stderr || stdout || `Exit code: ${code}`);
        }
      });

      child.on('error', (error: Error) => {
        finish(false, '', error.message);
      });

      // Handle timeout
      const timer = setTimeout(() => {
        // Try graceful kill first
        child.kill('SIGTERM');

        // Force kill after 2 seconds if still alive
        setTimeout(() => {
          if (!resolved) {
            try {
              child.kill('SIGKILL');
            } catch {}
          }
        }, 2000);

        const partialOutput = stdout || stderr;
        finish(
          false,
          '',
          `Command timed out after ${actualTimeout}ms${partialOutput ? '. Partial output:\n' + partialOutput.slice(0, 5000) : ''}`
        );
      }, actualTimeout);
    });
  },
};
