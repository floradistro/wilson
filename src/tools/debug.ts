/**
 * Debug & Feedback Tools
 *
 * Provides self-feedback loops for Wilson:
 * - Error parsing and analysis
 * - Log monitoring
 * - Build/test output analysis
 * - Stack trace parsing
 * - Automatic error categorization
 */

import { execSync } from 'child_process';
import { existsSync, readFileSync, statSync, watch, readdirSync } from 'fs';
import { join, basename, dirname } from 'path';
import type { Tool, ToolResult } from '../types.js';

// =============================================================================
// Types
// =============================================================================

interface ErrorInfo {
  type: ErrorType;
  message: string;
  file?: string;
  line?: number;
  column?: number;
  stack?: string[];
  suggestion?: string;
}

type ErrorType =
  | 'syntax'
  | 'type'
  | 'runtime'
  | 'import'
  | 'build'
  | 'test'
  | 'lint'
  | 'network'
  | 'permission'
  | 'unknown';

interface LogEntry {
  timestamp: string;
  level: 'error' | 'warn' | 'info' | 'debug';
  message: string;
  source?: string;
}

// =============================================================================
// Error Pattern Matching
// =============================================================================

const ERROR_PATTERNS: Array<{
  pattern: RegExp;
  type: ErrorType;
  extract: (match: RegExpMatchArray) => Partial<ErrorInfo>;
}> = [
  // TypeScript errors
  {
    pattern: /(.+)\((\d+),(\d+)\):\s*error\s*TS(\d+):\s*(.+)/,
    type: 'type',
    extract: (m) => ({
      file: m[1],
      line: parseInt(m[2]),
      column: parseInt(m[3]),
      message: `TS${m[4]}: ${m[5]}`,
    }),
  },
  // ESLint errors
  {
    pattern: /(.+):(\d+):(\d+):\s*(error|warning)\s+(.+)\s+(\S+)$/,
    type: 'lint',
    extract: (m) => ({
      file: m[1],
      line: parseInt(m[2]),
      column: parseInt(m[3]),
      message: `${m[5]} (${m[6]})`,
    }),
  },
  // Node.js errors with stack
  {
    pattern: /(\w+Error):\s*(.+)/,
    type: 'runtime',
    extract: (m) => ({
      message: `${m[1]}: ${m[2]}`,
    }),
  },
  // Stack trace lines
  {
    pattern: /at\s+(?:(.+)\s+\()?(.+):(\d+):(\d+)\)?/,
    type: 'runtime',
    extract: (m) => ({
      file: m[2],
      line: parseInt(m[3]),
      column: parseInt(m[4]),
      message: m[1] ? `at ${m[1]}` : 'at anonymous',
    }),
  },
  // Import/require errors
  {
    pattern: /Cannot find module ['"](.+)['"]/,
    type: 'import',
    extract: (m) => ({
      message: `Cannot find module '${m[1]}'`,
      suggestion: `Try: npm install ${m[1].split('/')[0]}`,
    }),
  },
  // Syntax errors
  {
    pattern: /SyntaxError:\s*(.+)/,
    type: 'syntax',
    extract: (m) => ({
      message: `SyntaxError: ${m[1]}`,
    }),
  },
  // Build errors (webpack, vite, etc.)
  {
    pattern: /ERROR\s+in\s+(.+)/i,
    type: 'build',
    extract: (m) => ({
      message: m[1],
    }),
  },
  // Test failures (Jest, Vitest, etc.)
  {
    pattern: /FAIL\s+(.+)/,
    type: 'test',
    extract: (m) => ({
      file: m[1],
      message: `Test failed: ${m[1]}`,
    }),
  },
  // Permission errors
  {
    pattern: /EACCES|EPERM|permission denied/i,
    type: 'permission',
    extract: () => ({
      message: 'Permission denied',
      suggestion: 'Check file permissions or run with appropriate privileges',
    }),
  },
  // Network errors
  {
    pattern: /ECONNREFUSED|ETIMEDOUT|ENOTFOUND|network/i,
    type: 'network',
    extract: () => ({
      message: 'Network error',
      suggestion: 'Check network connection and server availability',
    }),
  },
];

// =============================================================================
// Error Parsing
// =============================================================================

function parseErrors(output: string): ErrorInfo[] {
  const errors: ErrorInfo[] = [];
  const lines = output.split('\n');
  let currentStack: string[] = [];

  for (const line of lines) {
    // Check each error pattern
    for (const { pattern, type, extract } of ERROR_PATTERNS) {
      const match = line.match(pattern);
      if (match) {
        // If we have a stack trace building, attach it to the last error
        if (currentStack.length > 0 && errors.length > 0) {
          errors[errors.length - 1].stack = currentStack;
          currentStack = [];
        }

        const info = extract(match);
        errors.push({
          type,
          message: info.message || line,
          ...info,
        });
        break;
      }
    }

    // Collect stack trace lines
    if (line.trim().startsWith('at ')) {
      currentStack.push(line.trim());
    }
  }

  // Attach any remaining stack to the last error
  if (currentStack.length > 0 && errors.length > 0) {
    errors[errors.length - 1].stack = currentStack;
  }

  return errors;
}

function categorizeOutput(output: string): {
  hasErrors: boolean;
  hasWarnings: boolean;
  errorCount: number;
  warningCount: number;
  errors: ErrorInfo[];
  summary: string;
} {
  const errors = parseErrors(output);
  const hasErrors = errors.length > 0 || /error|fail|exception/i.test(output);
  const hasWarnings = /warning|warn/i.test(output);
  const errorCount = errors.length || (output.match(/error/gi) || []).length;
  const warningCount = (output.match(/warning|warn/gi) || []).length;

  let summary = '';
  if (errors.length > 0) {
    const byType = errors.reduce((acc, e) => {
      acc[e.type] = (acc[e.type] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);

    summary = Object.entries(byType)
      .map(([type, count]) => `${count} ${type} error${count > 1 ? 's' : ''}`)
      .join(', ');
  } else if (hasErrors) {
    summary = `${errorCount} error${errorCount > 1 ? 's' : ''} detected`;
  } else {
    summary = 'No errors detected';
  }

  return { hasErrors, hasWarnings, errorCount, warningCount, errors, summary };
}

// =============================================================================
// Log Parsing
// =============================================================================

function parseLogFile(content: string, maxLines = 100): LogEntry[] {
  const entries: LogEntry[] = [];
  const lines = content.split('\n').slice(-maxLines);

  for (const line of lines) {
    if (!line.trim()) continue;

    // Try to parse structured logs (JSON)
    try {
      const parsed = JSON.parse(line);
      if (parsed.timestamp || parsed.level || parsed.message) {
        entries.push({
          timestamp: parsed.timestamp || new Date().toISOString(),
          level: parsed.level?.toLowerCase() || 'info',
          message: parsed.message || parsed.msg || JSON.stringify(parsed),
          source: parsed.source || parsed.name,
        });
        continue;
      }
    } catch {}

    // Parse common log formats
    // Format: [TIMESTAMP] [LEVEL] message
    const bracketMatch = line.match(/\[([^\]]+)\]\s*\[([^\]]+)\]\s*(.+)/);
    if (bracketMatch) {
      entries.push({
        timestamp: bracketMatch[1],
        level: bracketMatch[2].toLowerCase() as LogEntry['level'],
        message: bracketMatch[3],
      });
      continue;
    }

    // Format: TIMESTAMP LEVEL: message
    const colonMatch = line.match(/^(\S+\s+\S+)\s+(ERROR|WARN|INFO|DEBUG):\s*(.+)/i);
    if (colonMatch) {
      entries.push({
        timestamp: colonMatch[1],
        level: colonMatch[2].toLowerCase() as LogEntry['level'],
        message: colonMatch[3],
      });
      continue;
    }

    // Detect level from keywords
    let level: LogEntry['level'] = 'info';
    if (/error|exception|fail/i.test(line)) level = 'error';
    else if (/warn/i.test(line)) level = 'warn';
    else if (/debug/i.test(line)) level = 'debug';

    entries.push({
      timestamp: new Date().toISOString(),
      level,
      message: line,
    });
  }

  return entries;
}

// =============================================================================
// Suggestion Generation
// =============================================================================

function generateSuggestions(errors: ErrorInfo[]): string[] {
  const suggestions: string[] = [];

  for (const error of errors) {
    if (error.suggestion) {
      suggestions.push(error.suggestion);
      continue;
    }

    switch (error.type) {
      case 'type':
        suggestions.push(`Check types in ${error.file || 'the file'} at line ${error.line || '?'}`);
        break;
      case 'import':
        if (error.message.includes('Cannot find module')) {
          const module = error.message.match(/['"](.+)['"]/)?.[1];
          if (module) {
            suggestions.push(`Install missing dependency: npm install ${module.split('/')[0]}`);
          }
        }
        break;
      case 'syntax':
        suggestions.push('Check for missing brackets, semicolons, or quotes');
        break;
      case 'test':
        suggestions.push('Run tests with --verbose to see detailed failure info');
        break;
      case 'build':
        suggestions.push('Try clearing build cache: rm -rf .next node_modules/.cache');
        break;
      case 'permission':
        suggestions.push('Check file permissions or ownership');
        break;
      case 'network':
        suggestions.push('Check if the server/service is running and accessible');
        break;
    }
  }

  return [...new Set(suggestions)]; // Deduplicate
}

// =============================================================================
// Tool Implementation
// =============================================================================

export const debugTool: Tool = {
  async execute(params: Record<string, unknown>): Promise<ToolResult> {
    const {
      action,
      output,
      path,
      command,
      lines = 100,
      level,
    } = params as {
      action: string;
      output?: string;
      path?: string;
      command?: string;
      lines?: number;
      level?: string;
    };

    if (!action) {
      return { success: false, error: 'Missing action' };
    }

    switch (action) {
      // =====================================================================
      // ANALYZE - Parse and analyze error output
      // =====================================================================
      case 'analyze': {
        if (!output) {
          return { success: false, error: 'Missing output to analyze' };
        }

        const analysis = categorizeOutput(output);
        const suggestions = generateSuggestions(analysis.errors);

        return {
          success: true,
          content: JSON.stringify({
            hasErrors: analysis.hasErrors,
            hasWarnings: analysis.hasWarnings,
            errorCount: analysis.errorCount,
            warningCount: analysis.warningCount,
            summary: analysis.summary,
            errors: analysis.errors.slice(0, 20), // Limit to first 20
            suggestions,
            // Include raw for context
            rawPreview: output.slice(0, 500),
          }, null, 2),
        };
      }

      // =====================================================================
      // RUN-CHECK - Run a command and analyze output
      // =====================================================================
      case 'run-check': {
        if (!command) {
          return { success: false, error: 'Missing command' };
        }

        try {
          const cwd = path || process.cwd();
          const result = execSync(command, {
            encoding: 'utf8',
            timeout: 120000,
            maxBuffer: 10 * 1024 * 1024,
            cwd,
            stdio: ['pipe', 'pipe', 'pipe'],
          });

          const analysis = categorizeOutput(result);

          return {
            success: true,
            content: JSON.stringify({
              exitCode: 0,
              success: true,
              ...analysis,
              output: result.slice(0, 5000),
            }, null, 2),
          };
        } catch (error) {
          const err = error as NodeJS.ErrnoException & { stdout?: string; stderr?: string; status?: number };
          const combinedOutput = (err.stdout || '') + '\n' + (err.stderr || '');
          const analysis = categorizeOutput(combinedOutput);
          const suggestions = generateSuggestions(analysis.errors);

          return {
            success: true, // Tool succeeded, command failed
            content: JSON.stringify({
              exitCode: err.status || 1,
              success: false,
              ...analysis,
              suggestions,
              output: combinedOutput.slice(0, 5000),
            }, null, 2),
          };
        }
      }

      // =====================================================================
      // READ-LOG - Read and parse log files
      // =====================================================================
      case 'read-log': {
        if (!path) {
          return { success: false, error: 'Missing log file path' };
        }

        if (!existsSync(path)) {
          return { success: false, error: `Log file not found: ${path}` };
        }

        try {
          const content = readFileSync(path, 'utf8');
          const entries = parseLogFile(content, lines);

          // Filter by level if specified
          const filtered = level
            ? entries.filter(e => e.level === level)
            : entries;

          const errorCount = entries.filter(e => e.level === 'error').length;
          const warnCount = entries.filter(e => e.level === 'warn').length;

          return {
            success: true,
            content: JSON.stringify({
              file: path,
              totalEntries: entries.length,
              filteredEntries: filtered.length,
              errorCount,
              warnCount,
              entries: filtered.slice(-50), // Last 50 matching entries
              hasErrors: errorCount > 0,
            }, null, 2),
          };
        } catch (error) {
          return {
            success: false,
            error: error instanceof Error ? error.message : 'Failed to read log',
          };
        }
      }

      // =====================================================================
      // FIND-LOGS - Find log files in a project
      // =====================================================================
      case 'find-logs': {
        const searchPath = path || process.cwd();
        const logPatterns = [
          '*.log',
          'logs/*.log',
          '.next/trace',
          'npm-debug.log*',
          'yarn-error.log',
          '.wilson/logs/*',
        ];

        const found: Array<{ path: string; size: number; modified: string }> = [];

        function searchDir(dir: string, depth = 0) {
          if (depth > 3) return; // Limit depth

          try {
            const entries = readdirSync(dir, { withFileTypes: true });

            for (const entry of entries) {
              const fullPath = join(dir, entry.name);

              // Skip node_modules and .git
              if (entry.name === 'node_modules' || entry.name === '.git') continue;

              if (entry.isDirectory()) {
                searchDir(fullPath, depth + 1);
              } else if (entry.name.endsWith('.log') || entry.name.includes('error') || entry.name.includes('debug')) {
                try {
                  const stats = statSync(fullPath);
                  found.push({
                    path: fullPath,
                    size: stats.size,
                    modified: stats.mtime.toISOString(),
                  });
                } catch {}
              }
            }
          } catch {}
        }

        searchDir(searchPath);

        // Sort by modified date (newest first)
        found.sort((a, b) => new Date(b.modified).getTime() - new Date(a.modified).getTime());

        return {
          success: true,
          content: JSON.stringify({
            searchPath,
            found: found.slice(0, 20),
            count: found.length,
          }, null, 2),
        };
      }

      // =====================================================================
      // STACK-TRACE - Parse a stack trace
      // =====================================================================
      case 'stack-trace': {
        if (!output) {
          return { success: false, error: 'Missing stack trace output' };
        }

        const errors = parseErrors(output);
        const mainError = errors[0];

        // Extract file locations from stack
        const locations: Array<{ file: string; line: number; function?: string }> = [];
        const stackLines = output.split('\n').filter(l => l.trim().startsWith('at '));

        for (const line of stackLines) {
          const match = line.match(/at\s+(?:(.+)\s+\()?(.+):(\d+):(\d+)\)?/);
          if (match) {
            locations.push({
              file: match[2],
              line: parseInt(match[3]),
              function: match[1],
            });
          }
        }

        return {
          success: true,
          content: JSON.stringify({
            error: mainError?.message || 'Unknown error',
            type: mainError?.type || 'unknown',
            locations: locations.slice(0, 10),
            suggestion: mainError?.suggestion,
            rawStack: stackLines.slice(0, 10),
          }, null, 2),
        };
      }

      // =====================================================================
      // WATCH - Set up file watching for errors (returns immediately)
      // =====================================================================
      case 'watch': {
        // This is informational - actual watching would need to be in a service
        return {
          success: true,
          content: JSON.stringify({
            message: 'File watching should be handled by the dev server.',
            tip: 'Use DevServer tool with hot-reload for automatic error detection.',
            alternatives: [
              'DevServer action=logs - Get current server logs',
              'Debug action=run-check command="npm run build" - Check for build errors',
              'Debug action=read-log path="./logs/error.log" - Read error logs',
            ],
          }, null, 2),
        };
      }

      // =====================================================================
      // HEALTH - Check project health (common issues)
      // =====================================================================
      case 'health': {
        const projectPath = path || process.cwd();
        const issues: string[] = [];
        const checks: Record<string, boolean> = {};

        // Check package.json exists
        const pkgPath = join(projectPath, 'package.json');
        checks['package.json'] = existsSync(pkgPath);
        if (!checks['package.json']) {
          issues.push('No package.json found');
        }

        // Check node_modules
        const nmPath = join(projectPath, 'node_modules');
        checks['node_modules'] = existsSync(nmPath);
        if (!checks['node_modules']) {
          issues.push('node_modules not found - run npm install');
        }

        // Check for lock files
        checks['lockfile'] = existsSync(join(projectPath, 'package-lock.json')) ||
          existsSync(join(projectPath, 'yarn.lock')) ||
          existsSync(join(projectPath, 'bun.lockb')) ||
          existsSync(join(projectPath, 'pnpm-lock.yaml'));
        if (!checks['lockfile']) {
          issues.push('No lock file found - dependencies may be inconsistent');
        }

        // Check .env
        checks['.env'] = existsSync(join(projectPath, '.env')) ||
          existsSync(join(projectPath, '.env.local'));

        // Check TypeScript config
        checks['tsconfig'] = existsSync(join(projectPath, 'tsconfig.json'));

        // Check for common error indicators
        try {
          const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));

          // Check for outdated patterns
          if (pkg.dependencies?.['react-scripts']) {
            issues.push('Using create-react-app (consider migrating to Vite or Next.js)');
          }

          // Check scripts
          checks['dev-script'] = !!pkg.scripts?.dev || !!pkg.scripts?.start;
          checks['build-script'] = !!pkg.scripts?.build;
          checks['test-script'] = !!pkg.scripts?.test;
        } catch {}

        return {
          success: true,
          content: JSON.stringify({
            projectPath,
            healthy: issues.length === 0,
            checks,
            issues,
            suggestions: issues.length > 0
              ? issues.map(i => {
                  if (i.includes('npm install')) return 'Run: npm install';
                  if (i.includes('lock file')) return 'Run: npm install to generate lock file';
                  return null;
                }).filter(Boolean)
              : ['Project looks healthy!'],
          }, null, 2),
        };
      }

      default:
        return {
          success: false,
          error: `Unknown action: ${action}. Valid: analyze, run-check, read-log, find-logs, stack-trace, watch, health`,
        };
    }
  },
};

// =============================================================================
// Exports
// =============================================================================

export const debugTools: Record<string, Tool> = {
  Debug: debugTool,
};

// Export helpers for use by other tools
export { parseErrors, categorizeOutput, generateSuggestions, parseLogFile };
