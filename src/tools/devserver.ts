/**
 * Dev Server Management Tool
 *
 * Intelligent dev server handling with:
 * - Auto-detection of framework (Next.js, Vite, etc.)
 * - Hot reload awareness
 * - Smart restart vs rebuild decisions
 * - Process health monitoring
 */

import { spawn, execSync, type ChildProcess } from 'child_process';
import { existsSync, readFileSync, statSync, watch, type FSWatcher } from 'fs';
import { join, basename } from 'path';
import type { Tool, ToolResult } from '../types.js';
import { getSupabaseEnv } from './env.js';

// =============================================================================
// Types
// =============================================================================

interface DevServer {
  id: string;
  pid: number;
  command: string;
  cwd: string;
  framework: Framework;
  port: number | null;
  startedAt: Date;
  child: ChildProcess;
  output: string[];
  status: 'starting' | 'running' | 'error' | 'stopped';
  lastError?: string;
  watcher?: FSWatcher;
}

type Framework =
  | 'nextjs'
  | 'vite'
  | 'nuxt'
  | 'remix'
  | 'astro'
  | 'create-react-app'
  | 'express'
  | 'bun'
  | 'node'
  | 'unknown';

interface FrameworkConfig {
  name: Framework;
  devCommand: string;
  buildCommand: string;
  configFiles: string[];
  // Files that require full restart (not just hot reload)
  restartTriggers: string[];
  // Files that require rebuild before restart
  rebuildTriggers: string[];
  defaultPort: number;
  readyPattern: RegExp;
}

// =============================================================================
// Framework Configurations
// =============================================================================

const FRAMEWORK_CONFIGS: Record<Framework, FrameworkConfig> = {
  nextjs: {
    name: 'nextjs',
    devCommand: 'npm run dev',
    buildCommand: 'npm run build',
    configFiles: ['next.config.js', 'next.config.mjs', 'next.config.ts'],
    restartTriggers: [
      'next.config.js', 'next.config.mjs', 'next.config.ts',
      'package.json', 'tsconfig.json', '.env.local', '.env'
    ],
    rebuildTriggers: [], // Next.js handles incremental builds
    defaultPort: 3000,
    readyPattern: /ready.*started.*on|Local:\s+http/i,
  },
  vite: {
    name: 'vite',
    devCommand: 'npm run dev',
    buildCommand: 'npm run build',
    configFiles: ['vite.config.js', 'vite.config.ts', 'vite.config.mjs'],
    restartTriggers: [
      'vite.config.js', 'vite.config.ts', 'vite.config.mjs',
      'package.json', 'tsconfig.json', '.env'
    ],
    rebuildTriggers: [],
    defaultPort: 5173,
    readyPattern: /Local:\s+http|ready in \d+/i,
  },
  nuxt: {
    name: 'nuxt',
    devCommand: 'npm run dev',
    buildCommand: 'npm run build',
    configFiles: ['nuxt.config.js', 'nuxt.config.ts'],
    restartTriggers: [
      'nuxt.config.js', 'nuxt.config.ts',
      'package.json', 'tsconfig.json', '.env'
    ],
    rebuildTriggers: [],
    defaultPort: 3000,
    readyPattern: /Nuxt.*ready|Local:\s+http/i,
  },
  remix: {
    name: 'remix',
    devCommand: 'npm run dev',
    buildCommand: 'npm run build',
    configFiles: ['remix.config.js', 'remix.config.ts'],
    restartTriggers: ['remix.config.js', 'remix.config.ts', 'package.json'],
    rebuildTriggers: [],
    defaultPort: 3000,
    readyPattern: /started.*http|Remix.*ready/i,
  },
  astro: {
    name: 'astro',
    devCommand: 'npm run dev',
    buildCommand: 'npm run build',
    configFiles: ['astro.config.mjs', 'astro.config.js', 'astro.config.ts'],
    restartTriggers: ['astro.config.mjs', 'astro.config.js', 'package.json'],
    rebuildTriggers: [],
    defaultPort: 4321,
    readyPattern: /Local.*http|watching for file changes/i,
  },
  'create-react-app': {
    name: 'create-react-app',
    devCommand: 'npm start',
    buildCommand: 'npm run build',
    configFiles: [],
    restartTriggers: ['package.json', '.env', '.env.local'],
    rebuildTriggers: [],
    defaultPort: 3000,
    readyPattern: /Compiled successfully|webpack compiled/i,
  },
  express: {
    name: 'express',
    devCommand: 'npm run dev',
    buildCommand: 'npm run build',
    configFiles: [],
    restartTriggers: ['package.json', '.env'],
    rebuildTriggers: ['tsconfig.json'], // TypeScript needs rebuild
    defaultPort: 3000,
    readyPattern: /listening on|server started|port \d+/i,
  },
  bun: {
    name: 'bun',
    devCommand: 'bun run dev',
    buildCommand: 'bun run build',
    configFiles: ['bunfig.toml'],
    restartTriggers: ['bunfig.toml', 'package.json', 'tsconfig.json'],
    rebuildTriggers: [],
    defaultPort: 3000,
    readyPattern: /listening|started|http/i,
  },
  node: {
    name: 'node',
    devCommand: 'npm run dev',
    buildCommand: 'npm run build',
    configFiles: [],
    restartTriggers: ['package.json', '.env'],
    rebuildTriggers: ['tsconfig.json'],
    defaultPort: 3000,
    readyPattern: /listening|started|ready/i,
  },
  unknown: {
    name: 'unknown',
    devCommand: 'npm run dev',
    buildCommand: 'npm run build',
    configFiles: [],
    restartTriggers: ['package.json'],
    rebuildTriggers: [],
    defaultPort: 3000,
    readyPattern: /listening|started|ready|http/i,
  },
};

// =============================================================================
// Server Registry
// =============================================================================

const servers = new Map<string, DevServer>();

// =============================================================================
// System Process Discovery
// =============================================================================

interface SystemProcess {
  pid: number;
  command: string;
  cwd?: string;
  port?: number;
  framework?: Framework;
  startedAt?: Date;
  cpu?: number;
  memory?: number;
}

/**
 * Discover all running dev servers on the system
 */
function discoverRunningServers(): SystemProcess[] {
  const processes: SystemProcess[] = [];

  try {
    // Get all node/bun processes with their commands
    const psOutput = execSync(
      'ps aux | grep -E "node|bun|next|vite|nuxt|remix" | grep -v grep',
      { encoding: 'utf8', timeout: 5000 }
    ).trim();

    if (!psOutput) return processes;

    const lines = psOutput.split('\n');

    for (const line of lines) {
      const parts = line.split(/\s+/);
      if (parts.length < 11) continue;

      const pid = parseInt(parts[1], 10);
      const cpu = parseFloat(parts[2]);
      const memory = parseFloat(parts[3]);
      const command = parts.slice(10).join(' ');

      // Skip non-dev server processes
      if (!isDevServerCommand(command)) continue;

      // Try to get the working directory
      let cwd: string | undefined;
      try {
        cwd = execSync(`lsof -p ${pid} 2>/dev/null | grep cwd | awk '{print $NF}'`, {
          encoding: 'utf8',
          timeout: 2000,
        }).trim() || undefined;
      } catch {}

      // Try to get the port
      let port: number | undefined;
      try {
        const lsofOutput = execSync(`lsof -i -P -n -p ${pid} 2>/dev/null | grep LISTEN`, {
          encoding: 'utf8',
          timeout: 2000,
        }).trim();
        const portMatch = lsofOutput.match(/:(\d+)\s/);
        if (portMatch) {
          port = parseInt(portMatch[1], 10);
        }
      } catch {}

      // Detect framework from command
      const framework = detectFrameworkFromCommand(command);

      processes.push({
        pid,
        command: command.slice(0, 200), // Truncate long commands
        cwd,
        port,
        framework,
        cpu,
        memory,
      });
    }
  } catch {
    // ps command failed, return empty
  }

  return processes;
}

/**
 * Check if a command looks like a dev server
 */
function isDevServerCommand(command: string): boolean {
  const devPatterns = [
    /\b(npm|yarn|pnpm|bun)\s+(run\s+)?(dev|start|serve)/i,
    /\bnext\s+dev/i,
    /\bnuxt\s+dev/i,
    /\bvite\b/i,
    /\bremix\s+dev/i,
    /\bastro\s+dev/i,
    /\bnodemon\b/i,
    /\bts-node-dev\b/i,
    /\bwebpack\s+(serve|dev)/i,
    /\bparcel\b/i,
    /\blive-server\b/i,
    /\bhttp-server\b/i,
    /\bserve\b/i,
    /AppEnhanced\.tsx/, // Wilson itself
  ];

  return devPatterns.some(p => p.test(command));
}

/**
 * Detect framework from command string
 */
function detectFrameworkFromCommand(command: string): Framework {
  if (/next/i.test(command)) return 'nextjs';
  if (/vite/i.test(command)) return 'vite';
  if (/nuxt/i.test(command)) return 'nuxt';
  if (/remix/i.test(command)) return 'remix';
  if (/astro/i.test(command)) return 'astro';
  if (/react-scripts/i.test(command)) return 'create-react-app';
  if (/bun/i.test(command)) return 'bun';
  if (/node/i.test(command)) return 'node';
  return 'unknown';
}

/**
 * Get ports in use by any process
 */
function getPortsInUse(): Map<number, { pid: number; process: string }> {
  const ports = new Map<number, { pid: number; process: string }>();

  try {
    const output = execSync('lsof -i -P -n | grep LISTEN', {
      encoding: 'utf8',
      timeout: 5000,
    }).trim();

    for (const line of output.split('\n')) {
      const parts = line.split(/\s+/);
      if (parts.length < 9) continue;

      const process = parts[0];
      const pid = parseInt(parts[1], 10);
      const portMatch = parts[8]?.match(/:(\d+)$/);

      if (portMatch) {
        const port = parseInt(portMatch[1], 10);
        ports.set(port, { pid, process });
      }
    }
  } catch {}

  return ports;
}

// =============================================================================
// Framework Detection
// =============================================================================

function detectFramework(projectPath: string): Framework {
  const packageJsonPath = join(projectPath, 'package.json');

  if (!existsSync(packageJsonPath)) {
    return 'unknown';
  }

  try {
    const pkg = JSON.parse(readFileSync(packageJsonPath, 'utf8'));
    const deps = { ...pkg.dependencies, ...pkg.devDependencies };

    // Check in order of specificity
    if (deps['next']) return 'nextjs';
    if (deps['nuxt']) return 'nuxt';
    if (deps['@remix-run/react']) return 'remix';
    if (deps['astro']) return 'astro';
    if (deps['vite']) return 'vite';
    if (deps['react-scripts']) return 'create-react-app';
    if (deps['express']) return 'express';

    // Check for bun
    if (existsSync(join(projectPath, 'bun.lockb')) || existsSync(join(projectPath, 'bunfig.toml'))) {
      return 'bun';
    }

    return 'node';
  } catch {
    return 'unknown';
  }
}

// =============================================================================
// Port Detection
// =============================================================================

function extractPort(output: string): number | null {
  // Common patterns: "http://localhost:3000", "port 3000", ":3000"
  const patterns = [
    /localhost:(\d+)/i,
    /127\.0\.0\.1:(\d+)/i,
    /port\s*[=:]?\s*(\d+)/i,
    /:(\d{4,5})\b/,
  ];

  for (const pattern of patterns) {
    const match = output.match(pattern);
    if (match) {
      const port = parseInt(match[1], 10);
      if (port >= 1024 && port <= 65535) {
        return port;
      }
    }
  }
  return null;
}

// =============================================================================
// Server Management
// =============================================================================

function generateServerId(cwd: string): string {
  return `dev-${basename(cwd)}-${Date.now().toString(36)}`;
}

async function startServer(
  projectPath: string,
  options: { command?: string; port?: number } = {}
): Promise<DevServer> {
  const framework = detectFramework(projectPath);
  const config = FRAMEWORK_CONFIGS[framework];
  const command = options.command || config.devCommand;
  const id = generateServerId(projectPath);

  // Check if bun should be used
  const useBun = existsSync(join(projectPath, 'bun.lockb'));
  const finalCommand = useBun ? command.replace(/^npm/, 'bun') : command;

  const supabaseEnv = getSupabaseEnv();

  const child = spawn('bash', ['-c', finalCommand], {
    cwd: projectPath,
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: true,
    env: {
      ...process.env,
      ...supabaseEnv,
      PORT: options.port?.toString() || config.defaultPort.toString(),
      FORCE_COLOR: '1', // Enable colored output
    },
  });

  const server: DevServer = {
    id,
    pid: child.pid!,
    command: finalCommand,
    cwd: projectPath,
    framework,
    port: options.port || null,
    startedAt: new Date(),
    child,
    output: [],
    status: 'starting',
  };

  // Capture output
  const addOutput = (data: Buffer) => {
    const line = data.toString();
    server.output.push(line);
    // Keep last 100 lines
    if (server.output.length > 100) {
      server.output.shift();
    }

    // Detect ready state
    if (server.status === 'starting' && config.readyPattern.test(line)) {
      server.status = 'running';
      server.port = server.port || extractPort(line);
    }

    // Detect port from output
    if (!server.port) {
      server.port = extractPort(line);
    }
  };

  child.stdout?.on('data', addOutput);
  child.stderr?.on('data', addOutput);

  child.on('error', (err) => {
    server.status = 'error';
    server.lastError = err.message;
  });

  child.on('close', (code) => {
    if (server.status !== 'stopped') {
      server.status = code === 0 ? 'stopped' : 'error';
      if (code !== 0) {
        server.lastError = `Process exited with code ${code}`;
      }
    }
    servers.delete(id);
  });

  child.unref();
  servers.set(id, server);

  // Wait for server to be ready (max 30 seconds)
  await waitForReady(server, 30000);

  return server;
}

async function waitForReady(server: DevServer, timeout: number): Promise<void> {
  const start = Date.now();

  while (Date.now() - start < timeout) {
    if (server.status === 'running') return;
    if (server.status === 'error') return;
    await new Promise(r => setTimeout(r, 500));
  }

  // Still starting after timeout - might be slow but ok
  if (server.status === 'starting') {
    server.status = 'running'; // Assume it's running
  }
}

function stopServer(id: string): boolean {
  const server = servers.get(id);
  if (!server) return false;

  try {
    server.status = 'stopped';
    server.child.kill('SIGTERM');

    // Force kill after 5 seconds
    setTimeout(() => {
      try {
        server.child.kill('SIGKILL');
      } catch {}
    }, 5000);

    if (server.watcher) {
      server.watcher.close();
    }

    servers.delete(id);
    return true;
  } catch {
    return false;
  }
}

async function restartServer(id: string): Promise<DevServer | null> {
  const server = servers.get(id);
  if (!server) return null;

  const { cwd, command, port } = server;
  stopServer(id);

  // Wait a moment for port to be released
  await new Promise(r => setTimeout(r, 1000));

  return startServer(cwd, { command, port: port || undefined });
}

// =============================================================================
// Change Detection
// =============================================================================

function needsRestart(projectPath: string, changedFile: string): boolean {
  const framework = detectFramework(projectPath);
  const config = FRAMEWORK_CONFIGS[framework];
  const fileName = basename(changedFile);

  return config.restartTriggers.some(trigger =>
    fileName === trigger || changedFile.endsWith(trigger)
  );
}

function needsRebuild(projectPath: string, changedFile: string): boolean {
  const framework = detectFramework(projectPath);
  const config = FRAMEWORK_CONFIGS[framework];
  const fileName = basename(changedFile);

  return config.rebuildTriggers.some(trigger =>
    fileName === trigger || changedFile.endsWith(trigger)
  );
}

// =============================================================================
// Tool Implementation
// =============================================================================

export const devServerTool: Tool = {
  async execute(params: Record<string, unknown>): Promise<ToolResult> {
    const {
      action,
      path: projectPath = process.cwd(),
      id,
      command,
      port,
      file,
    } = params as {
      action: string;
      path?: string;
      id?: string;
      command?: string;
      port?: number;
      file?: string; // For check-change action
    };

    if (!action) {
      return { success: false, error: 'Missing action' };
    }

    switch (action) {
      // =====================================================================
      // START - Start a new dev server
      // =====================================================================
      case 'start': {
        // Check if already running in this directory
        for (const server of servers.values()) {
          if (server.cwd === projectPath && server.status === 'running') {
            return {
              success: true,
              content: JSON.stringify({
                message: 'Server already running',
                id: server.id,
                port: server.port,
                framework: server.framework,
                status: server.status,
              }),
            };
          }
        }

        try {
          const server = await startServer(projectPath, { command, port });
          return {
            success: true,
            content: JSON.stringify({
              id: server.id,
              pid: server.pid,
              port: server.port,
              framework: server.framework,
              status: server.status,
              command: server.command,
              output: server.output.slice(-10).join(''),
            }),
          };
        } catch (error) {
          return {
            success: false,
            error: error instanceof Error ? error.message : 'Failed to start server',
          };
        }
      }

      // =====================================================================
      // STOP - Stop a dev server
      // =====================================================================
      case 'stop': {
        if (!id) {
          // Stop all servers in this directory
          let stopped = 0;
          for (const server of servers.values()) {
            if (server.cwd === projectPath) {
              stopServer(server.id);
              stopped++;
            }
          }
          return {
            success: true,
            content: `Stopped ${stopped} server(s)`,
          };
        }

        if (stopServer(id)) {
          return { success: true, content: `Server ${id} stopped` };
        }
        return { success: false, error: `Server ${id} not found` };
      }

      // =====================================================================
      // RESTART - Restart a dev server
      // =====================================================================
      case 'restart': {
        if (!id) {
          // Find server in this directory
          for (const server of servers.values()) {
            if (server.cwd === projectPath) {
              const newServer = await restartServer(server.id);
              if (newServer) {
                return {
                  success: true,
                  content: JSON.stringify({
                    message: 'Server restarted',
                    id: newServer.id,
                    port: newServer.port,
                    status: newServer.status,
                  }),
                };
              }
            }
          }
          return { success: false, error: 'No server found to restart' };
        }

        const newServer = await restartServer(id);
        if (newServer) {
          return {
            success: true,
            content: JSON.stringify({
              message: 'Server restarted',
              id: newServer.id,
              port: newServer.port,
              status: newServer.status,
            }),
          };
        }
        return { success: false, error: `Server ${id} not found` };
      }

      // =====================================================================
      // LIST - List all running dev servers (managed + system-wide)
      // =====================================================================
      case 'list': {
        // Get Wilson-managed servers
        const managed = Array.from(servers.values()).map(s => ({
          id: s.id,
          pid: s.pid,
          cwd: s.cwd,
          framework: s.framework,
          port: s.port,
          status: s.status,
          uptime: Math.round((Date.now() - s.startedAt.getTime()) / 1000),
          managed: true,
        }));

        // Discover system-wide dev servers
        const system = discoverRunningServers()
          .filter(p => !managed.some(m => m.pid === p.pid)) // Exclude already managed
          .map(p => ({
            id: `system-${p.pid}`,
            pid: p.pid,
            cwd: p.cwd || 'unknown',
            framework: p.framework || 'unknown',
            port: p.port,
            status: 'running' as const,
            command: p.command,
            cpu: p.cpu,
            memory: p.memory,
            managed: false,
          }));

        const all = [...managed, ...system];

        return {
          success: true,
          content: JSON.stringify({
            servers: all,
            count: all.length,
            managed: managed.length,
            discovered: system.length,
          }),
        };
      }

      // =====================================================================
      // DISCOVER - Find all dev servers system-wide (detailed)
      // =====================================================================
      case 'discover': {
        const discovered = discoverRunningServers();

        return {
          success: true,
          content: JSON.stringify({
            servers: discovered,
            count: discovered.length,
          }),
        };
      }

      // =====================================================================
      // PORTS - Show all ports in use
      // =====================================================================
      case 'ports': {
        const ports = getPortsInUse();
        const portList = Array.from(ports.entries())
          .filter(([port]) => port >= 1024 && port < 65535) // Skip system ports
          .sort((a, b) => a[0] - b[0])
          .map(([port, info]) => ({
            port,
            pid: info.pid,
            process: info.process,
          }));

        // Highlight common dev ports
        const devPorts = portList.filter(p =>
          [3000, 3001, 3002, 4000, 5000, 5173, 5174, 8000, 8080, 8888].includes(p.port)
        );

        return {
          success: true,
          content: JSON.stringify({
            devPorts,
            allPorts: portList.slice(0, 50), // Limit output
            totalPorts: portList.length,
          }),
        };
      }

      // =====================================================================
      // KILL - Kill a process by PID (system-wide)
      // =====================================================================
      case 'kill': {
        const targetPid = params.pid as number;
        if (!targetPid) {
          return { success: false, error: 'Missing pid parameter' };
        }

        try {
          process.kill(targetPid, 'SIGTERM');

          // Also remove from managed servers if present
          for (const [serverId, server] of servers.entries()) {
            if (server.pid === targetPid) {
              servers.delete(serverId);
              break;
            }
          }

          return {
            success: true,
            content: `Sent SIGTERM to process ${targetPid}`,
          };
        } catch (error) {
          return {
            success: false,
            error: `Failed to kill process ${targetPid}: ${error instanceof Error ? error.message : 'Unknown error'}`,
          };
        }
      }

      // =====================================================================
      // LOGS - Get server output
      // =====================================================================
      case 'logs': {
        const server = id
          ? servers.get(id)
          : Array.from(servers.values()).find(s => s.cwd === projectPath);

        if (!server) {
          return { success: false, error: 'Server not found' };
        }

        return {
          success: true,
          content: server.output.join(''),
        };
      }

      // =====================================================================
      // STATUS - Get server status
      // =====================================================================
      case 'status': {
        const server = id
          ? servers.get(id)
          : Array.from(servers.values()).find(s => s.cwd === projectPath);

        if (!server) {
          return {
            success: true,
            content: JSON.stringify({ running: false }),
          };
        }

        return {
          success: true,
          content: JSON.stringify({
            running: server.status === 'running',
            id: server.id,
            pid: server.pid,
            port: server.port,
            framework: server.framework,
            status: server.status,
            uptime: Math.round((Date.now() - server.startedAt.getTime()) / 1000),
            lastError: server.lastError,
          }),
        };
      }

      // =====================================================================
      // CHECK-CHANGE - Check if a file change needs restart/rebuild
      // =====================================================================
      case 'check-change': {
        if (!file) {
          return { success: false, error: 'Missing file parameter' };
        }

        const framework = detectFramework(projectPath);
        const restart = needsRestart(projectPath, file);
        const rebuild = needsRebuild(projectPath, file);

        return {
          success: true,
          content: JSON.stringify({
            file,
            framework,
            needsRestart: restart,
            needsRebuild: rebuild,
            action: rebuild ? 'rebuild' : restart ? 'restart' : 'hot-reload',
            recommendation: rebuild
              ? 'Run build then restart server'
              : restart
                ? 'Restart dev server'
                : 'Hot reload will handle this automatically',
          }),
        };
      }

      // =====================================================================
      // DETECT - Detect framework and recommended commands
      // =====================================================================
      case 'detect': {
        const framework = detectFramework(projectPath);
        const config = FRAMEWORK_CONFIGS[framework];

        return {
          success: true,
          content: JSON.stringify({
            framework,
            devCommand: config.devCommand,
            buildCommand: config.buildCommand,
            defaultPort: config.defaultPort,
            configFiles: config.configFiles,
            restartTriggers: config.restartTriggers,
            rebuildTriggers: config.rebuildTriggers,
          }),
        };
      }

      default:
        return {
          success: false,
          error: `Unknown action: ${action}. Valid: start, stop, restart, list, logs, status, check-change, detect`,
        };
    }
  },
};

// =============================================================================
// Exports
// =============================================================================

export const devServerTools: Record<string, Tool> = {
  DevServer: devServerTool,
};

// Helper exports for other tools
export { servers, stopServer, restartServer, needsRestart, needsRebuild, detectFramework };
