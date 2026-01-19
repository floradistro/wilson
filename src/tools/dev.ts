/**
 * Development & Project Management Tools
 *
 * Local tools for npm, bun, git, and other dev workflows.
 * These run on the client machine where Wilson CLI is installed.
 */

import { execSync } from 'child_process';
import type { Tool, ToolResult } from '../types.js';

// =============================================================================
// Types
// =============================================================================

interface NpmParams {
  action: string;
  script?: string;
  packages?: string[];
  path?: string;
  dev?: boolean;
}

interface GitParams {
  action: string;
  path?: string;
  branch?: string;
  message?: string;
  files?: string[];
  count?: number;
}

interface BunParams {
  action: string;
  script?: string;
  packages?: string[];
  path?: string;
  dev?: boolean;
}

// =============================================================================
// Helper Functions
// =============================================================================

const DEFAULT_TIMEOUT = 120000; // 2 minutes
const MAX_OUTPUT = 50000;

function sanitize(str: string): string {
  return str.replace(/[`$();&|<>]/g, '');
}

function truncateOutput(output: string): string {
  if (output.length > MAX_OUTPUT) {
    return output.slice(0, MAX_OUTPUT) + '\n...(output truncated)';
  }
  return output;
}

// =============================================================================
// NPM Tool
// =============================================================================

export const npmTool: Tool = {
  async execute(params: Record<string, unknown>): Promise<ToolResult> {
    const {
      action,
      script,
      packages = [],
      path,
      dev = false,
    } = params as unknown as NpmParams;

    if (!action) {
      return { success: false, error: 'Missing action' };
    }

    try {
      const cwd = path ? sanitize(path) : process.cwd();
      let cmd: string;

      switch (action) {
        case 'install':
          if (packages.length > 0) {
            const pkgList = packages.map(p => sanitize(p)).join(' ');
            cmd = dev ? `npm install --save-dev ${pkgList}` : `npm install ${pkgList}`;
          } else {
            cmd = 'npm install';
          }
          break;

        case 'build':
          cmd = 'npm run build';
          break;

        case 'test':
          cmd = 'npm test';
          break;

        case 'run':
          if (!script) return { success: false, error: 'Script name required for run action' };
          cmd = `npm run ${sanitize(script)}`;
          break;

        case 'audit':
          cmd = 'npm audit';
          break;

        case 'outdated':
          cmd = 'npm outdated';
          break;

        case 'update':
          if (packages.length > 0) {
            cmd = `npm update ${packages.map(p => sanitize(p)).join(' ')}`;
          } else {
            cmd = 'npm update';
          }
          break;

        case 'list':
          cmd = 'npm list --depth=0';
          break;

        case 'uninstall':
          if (packages.length === 0) return { success: false, error: 'Package name(s) required' };
          cmd = `npm uninstall ${packages.map(p => sanitize(p)).join(' ')}`;
          break;

        default:
          return { success: false, error: `Unknown action: ${action}. Valid: install, build, test, run, audit, outdated, update, list, uninstall` };
      }

      const output = execSync(cmd, {
        encoding: 'utf8',
        timeout: DEFAULT_TIMEOUT,
        maxBuffer: 10 * 1024 * 1024,
        cwd,
      });

      return { success: true, content: truncateOutput(output.trim() || 'Command completed') };
    } catch (error) {
      // npm often uses stderr for non-error output
      if (error instanceof Error && 'stdout' in error) {
        const stdout = (error as NodeJS.ErrnoException & { stdout?: string }).stdout || '';
        const stderr = (error as NodeJS.ErrnoException & { stderr?: string }).stderr || '';
        if (stdout || stderr) {
          return { success: false, error: truncateOutput(stderr || stdout) };
        }
      }
      return { success: false, error: error instanceof Error ? error.message : 'npm command failed' };
    }
  },
};

// =============================================================================
// Git Tool
// =============================================================================

export const gitTool: Tool = {
  async execute(params: Record<string, unknown>): Promise<ToolResult> {
    const {
      action,
      path,
      branch,
      message,
      files = [],
      count = 10,
    } = params as unknown as GitParams;

    if (!action) {
      return { success: false, error: 'Missing action' };
    }

    try {
      const cwd = path ? sanitize(path) : process.cwd();
      let cmd: string;

      switch (action) {
        case 'status':
          cmd = 'git status';
          break;

        case 'diff':
          cmd = files.length > 0
            ? `git diff ${files.map(f => sanitize(f)).join(' ')}`
            : 'git diff';
          break;

        case 'log':
          cmd = `git log --oneline -n ${Math.min(count, 100)}`;
          break;

        case 'branch':
          if (branch) {
            cmd = `git branch ${sanitize(branch)}`;
          } else {
            cmd = 'git branch -a';
          }
          break;

        case 'checkout':
          if (!branch) return { success: false, error: 'Branch name required' };
          cmd = `git checkout ${sanitize(branch)}`;
          break;

        case 'add':
          if (files.length > 0) {
            cmd = `git add ${files.map(f => sanitize(f)).join(' ')}`;
          } else {
            cmd = 'git add -A';
          }
          break;

        case 'commit':
          if (!message) return { success: false, error: 'Commit message required' };
          // Use single quotes and escape internal quotes
          const safeMessage = message.replace(/'/g, "'\\''");
          cmd = `git commit -m '${safeMessage}'`;
          break;

        case 'push':
          cmd = branch ? `git push origin ${sanitize(branch)}` : 'git push';
          break;

        case 'pull':
          cmd = branch ? `git pull origin ${sanitize(branch)}` : 'git pull';
          break;

        case 'stash':
          cmd = message ? `git stash push -m '${message.replace(/'/g, "'\\''")}'` : 'git stash';
          break;

        case 'stash-pop':
          cmd = 'git stash pop';
          break;

        case 'stash-list':
          cmd = 'git stash list';
          break;

        case 'fetch':
          cmd = 'git fetch --all';
          break;

        case 'remote':
          cmd = 'git remote -v';
          break;

        case 'show':
          cmd = 'git show --stat HEAD';
          break;

        default:
          return { success: false, error: `Unknown action: ${action}. Valid: status, diff, log, branch, checkout, add, commit, push, pull, stash, stash-pop, stash-list, fetch, remote, show` };
      }

      const output = execSync(cmd, {
        encoding: 'utf8',
        timeout: 60000,
        maxBuffer: 10 * 1024 * 1024,
        cwd,
      });

      return { success: true, content: truncateOutput(output.trim() || 'Command completed') };
    } catch (error) {
      if (error instanceof Error && 'stderr' in error) {
        const stderr = (error as NodeJS.ErrnoException & { stderr?: string }).stderr || '';
        return { success: false, error: stderr || error.message };
      }
      return { success: false, error: error instanceof Error ? error.message : 'git command failed' };
    }
  },
};

// =============================================================================
// Bun Tool
// =============================================================================

export const bunTool: Tool = {
  async execute(params: Record<string, unknown>): Promise<ToolResult> {
    const {
      action,
      script,
      packages = [],
      path,
      dev = false,
    } = params as unknown as BunParams;

    if (!action) {
      return { success: false, error: 'Missing action' };
    }

    try {
      const cwd = path ? sanitize(path) : process.cwd();
      let cmd: string;

      switch (action) {
        case 'install':
          cmd = 'bun install';
          break;

        case 'add':
          if (packages.length === 0) return { success: false, error: 'Package name(s) required' };
          const pkgList = packages.map(p => sanitize(p)).join(' ');
          cmd = dev ? `bun add -d ${pkgList}` : `bun add ${pkgList}`;
          break;

        case 'remove':
          if (packages.length === 0) return { success: false, error: 'Package name(s) required' };
          cmd = `bun remove ${packages.map(p => sanitize(p)).join(' ')}`;
          break;

        case 'build':
          cmd = 'bun run build';
          break;

        case 'test':
          cmd = 'bun test';
          break;

        case 'run':
          if (!script) return { success: false, error: 'Script name required for run action' };
          cmd = `bun run ${sanitize(script)}`;
          break;

        case 'update':
          cmd = 'bun update';
          break;

        case 'outdated':
          cmd = 'bun outdated';
          break;

        default:
          return { success: false, error: `Unknown action: ${action}. Valid: install, add, remove, build, test, run, update, outdated` };
      }

      const output = execSync(cmd, {
        encoding: 'utf8',
        timeout: DEFAULT_TIMEOUT,
        maxBuffer: 10 * 1024 * 1024,
        cwd,
      });

      return { success: true, content: truncateOutput(output.trim() || 'Command completed') };
    } catch (error) {
      if (error instanceof Error && 'stderr' in error) {
        const stderr = (error as NodeJS.ErrnoException & { stderr?: string }).stderr || '';
        return { success: false, error: stderr || error.message };
      }
      return { success: false, error: error instanceof Error ? error.message : 'bun command failed' };
    }
  },
};

// =============================================================================
// Exports
// =============================================================================

export const devTools: Record<string, Tool> = {
  Npm: npmTool,
  Git: gitTool,
  Bun: bunTool,
};
