import { appendFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

// =============================================================================
// Centralized Logger
// =============================================================================

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

interface LogEntry {
  timestamp: string;
  level: LogLevel;
  message: string;
  data?: unknown;
}

const LOG_LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

// Configuration
const LOG_DIR = join(homedir(), '.wilson', 'logs');
const LOG_FILE = join(LOG_DIR, 'wilson.log');
const MIN_LEVEL: LogLevel = (process.env.WILSON_LOG_LEVEL as LogLevel) || 'info';
const LOG_TO_FILE = process.env.WILSON_LOG_FILE !== 'false';
const LOG_TO_CONSOLE = process.env.NODE_ENV === 'development';

// Ensure log directory exists
function ensureLogDir() {
  if (LOG_TO_FILE && !existsSync(LOG_DIR)) {
    mkdirSync(LOG_DIR, { recursive: true });
  }
}

// Format log entry
function formatEntry(entry: LogEntry): string {
  const dataStr = entry.data ? ` ${JSON.stringify(entry.data)}` : '';
  return `[${entry.timestamp}] [${entry.level.toUpperCase()}] ${entry.message}${dataStr}`;
}

// Write to file
function writeToFile(entry: LogEntry) {
  if (!LOG_TO_FILE) return;
  try {
    ensureLogDir();
    appendFileSync(LOG_FILE, formatEntry(entry) + '\n');
  } catch {
    // Silent fail - don't crash app if logging fails
  }
}

// Main log function
function logMessage(level: LogLevel, message: string, data?: unknown) {
  if (LOG_LEVELS[level] < LOG_LEVELS[MIN_LEVEL]) return;

  const entry: LogEntry = {
    timestamp: new Date().toISOString(),
    level,
    message,
    data,
  };

  // Write to file
  writeToFile(entry);

  // Console output (only in dev or for errors)
  if (LOG_TO_CONSOLE || level === 'error') {
    const colors: Record<LogLevel, string> = {
      debug: '\x1b[90m',  // gray
      info: '\x1b[36m',   // cyan
      warn: '\x1b[33m',   // yellow
      error: '\x1b[31m',  // red
    };
    const reset = '\x1b[0m';
    const prefix = `${colors[level]}[${level.toUpperCase()}]${reset}`;

    if (level === 'error') {
      console.error(prefix, message, data || '');
    } else if (level === 'warn') {
      console.warn(prefix, message, data || '');
    } else {
      console.log(prefix, message, data || '');
    }
  }
}

// Export logger interface
export const log = {
  debug: (message: string, data?: unknown) => logMessage('debug', message, data),
  info: (message: string, data?: unknown) => logMessage('info', message, data),
  warn: (message: string, data?: unknown) => logMessage('warn', message, data),
  error: (message: string, data?: unknown) => logMessage('error', message, data),
};

// Utility to log API calls
export function logApi(method: string, url: string, status?: number, duration?: number) {
  log.debug(`API ${method} ${url}`, { status, duration: duration ? `${duration}ms` : undefined });
}

// Utility to log tool execution
export function logTool(name: string, status: 'start' | 'success' | 'error', duration?: number, error?: string) {
  if (status === 'error') {
    log.error(`Tool ${name} failed`, { error, duration });
  } else {
    log.debug(`Tool ${name} ${status}`, { duration });
  }
}

// =============================================================================
// Audit Logging - Security-relevant events always logged
// =============================================================================

const AUDIT_FILE = join(LOG_DIR, 'audit.log');

/**
 * Write audit entry - always written regardless of log level
 */
function writeAudit(event: string, data: Record<string, unknown>) {
  try {
    ensureLogDir();
    const entry = {
      timestamp: new Date().toISOString(),
      event,
      ...sanitizeAuditData(data),
    };
    appendFileSync(AUDIT_FILE, JSON.stringify(entry) + '\n');
  } catch {
    // Silent fail
  }
}

/**
 * Remove sensitive data before audit logging
 */
function sanitizeAuditData(data: Record<string, unknown>): Record<string, unknown> {
  const sensitiveKeys = ['password', 'token', 'key', 'secret', 'credential', 'apikey'];
  const sanitized: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(data)) {
    const isSecret = sensitiveKeys.some(s => key.toLowerCase().includes(s));
    if (isSecret) {
      sanitized[key] = '[REDACTED]';
    } else if (typeof value === 'object' && value !== null) {
      sanitized[key] = sanitizeAuditData(value as Record<string, unknown>);
    } else {
      sanitized[key] = value;
    }
  }

  return sanitized;
}

/**
 * Audit log for tool executions
 */
export function auditToolExecution(
  toolName: string,
  params: Record<string, unknown>,
  result: { success: boolean; error?: string },
  userId?: string
) {
  writeAudit('tool_execution', {
    tool: toolName,
    params,
    success: result.success,
    error: result.error,
    userId,
  });
}

/**
 * Audit log for auth events
 */
export function auditAuth(event: 'login' | 'logout' | 'token_refresh' | 'store_switch', data?: Record<string, unknown>) {
  writeAudit(`auth_${event}`, data || {});
}

/**
 * Audit log for dangerous command attempts
 */
export function auditDangerousCommand(command: string, blocked: boolean, reason?: string) {
  writeAudit('dangerous_command', {
    command: command.slice(0, 200), // Truncate for safety
    blocked,
    reason,
  });
}
