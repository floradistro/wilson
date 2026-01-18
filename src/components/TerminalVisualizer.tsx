/**
 * Terminal Visualizer - Beautiful rendering for commands and actions
 *
 * Provides visual feedback for:
 * - Command execution with status
 * - Step-by-step operations
 * - Test results
 * - Build/compile progress
 * - Any terminal action flow
 */

import React, { useState, useEffect, memo, useMemo } from 'react';
import { Box, Text } from 'ink';
import { highlight } from 'cli-highlight';
import chalk from 'chalk';

// =============================================================================
// Syntax Highlighting Theme (Material-inspired)
// =============================================================================

const syntaxTheme = {
  keyword: chalk.hex('#CC7832'),
  built_in: chalk.hex('#8888C6'),
  type: chalk.hex('#B5B6E3'),
  literal: chalk.hex('#6897BB'),
  number: chalk.hex('#6897BB'),
  string: chalk.hex('#6A8759'),
  comment: chalk.hex('#808080'),
  function: chalk.hex('#FFC66D'),
  class: chalk.hex('#A9B7C6'),
  variable: chalk.hex('#A9B7C6'),
  operator: chalk.hex('#A9B7C6'),
  punctuation: chalk.hex('#A9B7C6'),
  attr: chalk.hex('#BABABA'),
  tag: chalk.hex('#E8BF6A'),
  name: chalk.hex('#E8BF6A'),
};

// =============================================================================
// Syntax Highlighting Helper
// =============================================================================

function highlightCode(code: string, lang?: string): string {
  try {
    return highlight(code, {
      language: lang || 'javascript',
      ignoreIllegals: true,
      theme: syntaxTheme,
    });
  } catch {
    return code;
  }
}

function highlightLine(line: string): string {
  // Auto-detect and highlight common patterns

  // JSON objects/arrays
  if (/^\s*[\[{]/.test(line) || /[\]}]\s*$/.test(line)) {
    return highlightCode(line, 'json');
  }

  // Key-value patterns (like logs)
  if (/^\[[\w]+\]/.test(line)) {
    const match = line.match(/^(\[[\w]+\])\s*(.*)$/);
    if (match) {
      const level = match[1].toLowerCase();
      const levelColor = level.includes('error') || level.includes('fail') ? '#E06C75'
        : level.includes('warn') ? '#E5C07B'
        : level.includes('pass') || level.includes('success') ? '#98C379'
        : level.includes('debug') ? '#5C6370'
        : '#61AFEF';
      return chalk.hex(levelColor)(match[1]) + ' ' + highlightCode(match[2], 'javascript');
    }
  }

  // Numbers with units (like "234ms", "2.0 MB")
  line = line.replace(/(\d+\.?\d*)\s*(ms|s|MB|KB|GB|B)\b/g,
    (_, num, unit) => chalk.hex('#6897BB')(num) + chalk.hex('#5C6370')(unit));

  // File paths
  line = line.replace(/([\/~][\w\-\.\/]+\.\w+)/g,
    (path) => chalk.hex('#C792EA')(path));

  // URLs
  line = line.replace(/(https?:\/\/[^\s]+)/g,
    (url) => chalk.hex('#82AAFF').underline(url));

  // Strings in quotes
  line = line.replace(/"([^"]+)"/g,
    (_, str) => chalk.hex('#6A8759')(`"${str}"`));
  line = line.replace(/'([^']+)'/g,
    (_, str) => chalk.hex('#6A8759')(`'${str}'`));

  return line;
}

// =============================================================================
// Types
// =============================================================================

export type ActionStatus = 'pending' | 'running' | 'success' | 'error' | 'warning' | 'skipped';

export interface Action {
  id: string;
  label: string;
  status: ActionStatus;
  detail?: string;
  duration?: number;
  children?: Action[];
}

export interface CommandResult {
  command: string;
  status: ActionStatus;
  output?: string;
  error?: string;
  duration?: number;
}

// =============================================================================
// Constants
// =============================================================================

const SPINNER_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

const STATUS_CONFIG: Record<ActionStatus, { icon: string; color: string; label: string }> = {
  pending:  { icon: '○', color: '#5C6370', label: 'pending' },
  running:  { icon: '◐', color: '#61AFEF', label: 'running' },
  success:  { icon: '✓', color: '#98C379', label: 'success' },
  error:    { icon: '✗', color: '#E06C75', label: 'failed' },
  warning:  { icon: '⚠', color: '#E5C07B', label: 'warning' },
  skipped:  { icon: '○', color: '#5C6370', label: 'skipped' },
};

// =============================================================================
// Animated Spinner
// =============================================================================

const Spinner = memo(function Spinner({ color = '#61AFEF' }: { color?: string }) {
  const [frame, setFrame] = useState(0);

  useEffect(() => {
    const interval = setInterval(() => {
      setFrame((prev) => (prev + 1) % SPINNER_FRAMES.length);
    }, 80);
    return () => clearInterval(interval);
  }, []);

  return <Text color={color}>{SPINNER_FRAMES[frame]}</Text>;
});

// =============================================================================
// Status Icon
// =============================================================================

const StatusIcon = memo(function StatusIcon({ status }: { status: ActionStatus }) {
  const config = STATUS_CONFIG[status];

  if (status === 'running') {
    return <Spinner color={config.color} />;
  }

  return <Text color={config.color}>{config.icon}</Text>;
});

// =============================================================================
// Duration Display
// =============================================================================

const Duration = memo(function Duration({ ms }: { ms?: number }) {
  if (ms === undefined) return null;

  let color = '#5C6370';
  let text: string;

  if (ms < 1000) {
    text = `${ms}ms`;
    color = '#98C379';
  } else if (ms < 10000) {
    text = `${(ms / 1000).toFixed(1)}s`;
    color = '#ABB2BF';
  } else {
    text = `${(ms / 1000).toFixed(1)}s`;
    color = '#E5C07B';
  }

  return <Text color={color}>{text}</Text>;
});

// =============================================================================
// Single Action Row
// =============================================================================

export const ActionRow = memo(function ActionRow({
  action,
  indent = 0,
  showDuration = true,
}: {
  action: Action;
  indent?: number;
  showDuration?: boolean;
}) {
  const config = STATUS_CONFIG[action.status];
  const prefix = indent > 0 ? '  '.repeat(indent - 1) + '├─ ' : '';

  return (
    <Box flexDirection="column">
      <Box gap={1}>
        <Text color="#3E4451">{prefix}</Text>
        <StatusIcon status={action.status} />
        <Text color={action.status === 'running' ? '#FFFFFF' : '#ABB2BF'}>
          {action.label}
        </Text>
        {action.detail && (
          <Text color="#5C6370">({action.detail})</Text>
        )}
        <Box flexGrow={1} />
        {showDuration && <Duration ms={action.duration} />}
      </Box>

      {action.children?.map((child) => (
        <ActionRow key={child.id} action={child} indent={indent + 1} showDuration={showDuration} />
      ))}
    </Box>
  );
});

// =============================================================================
// Action List with Header
// =============================================================================

export interface ActionListProps {
  title: string;
  actions: Action[];
  showSummary?: boolean;
}

export const ActionList = memo(function ActionList({
  title,
  actions,
  showSummary = true,
}: ActionListProps) {
  const counts = {
    success: actions.filter(a => a.status === 'success').length,
    error: actions.filter(a => a.status === 'error').length,
    warning: actions.filter(a => a.status === 'warning').length,
    running: actions.filter(a => a.status === 'running').length,
    pending: actions.filter(a => a.status === 'pending').length,
  };

  const totalDuration = actions.reduce((sum, a) => sum + (a.duration || 0), 0);
  const isRunning = counts.running > 0;

  return (
    <Box flexDirection="column" marginY={1}>
      {/* Header */}
      <Box gap={1} marginBottom={1}>
        <Text color="#61AFEF" bold>→</Text>
        <Text color="#FFFFFF" bold>{title}</Text>
        {isRunning && <Spinner />}
      </Box>

      {/* Actions */}
      <Box flexDirection="column" marginLeft={2} borderStyle="single" borderColor="#3E4451" borderLeft borderTop={false} borderRight={false} borderBottom={false} paddingLeft={1}>
        {actions.map((action) => (
          <ActionRow key={action.id} action={action} />
        ))}
      </Box>

      {/* Summary */}
      {showSummary && actions.length > 0 && (
        <Box gap={2} marginTop={1} marginLeft={2}>
          {counts.success > 0 && (
            <Text color="#98C379">✓ {counts.success} passed</Text>
          )}
          {counts.error > 0 && (
            <Text color="#E06C75">✗ {counts.error} failed</Text>
          )}
          {counts.warning > 0 && (
            <Text color="#E5C07B">⚠ {counts.warning} warnings</Text>
          )}
          {totalDuration > 0 && (
            <>
              <Text color="#3E4451">│</Text>
              <Duration ms={totalDuration} />
            </>
          )}
        </Box>
      )}
    </Box>
  );
});

// =============================================================================
// Command Execution Display
// =============================================================================

export interface CommandDisplayProps {
  command: string;
  status: ActionStatus;
  output?: string;
  error?: string;
  duration?: number;
  showOutput?: boolean;
}

export const CommandDisplay = memo(function CommandDisplay({
  command,
  status,
  output,
  error,
  duration,
  showOutput = true,
}: CommandDisplayProps) {
  // Memoize highlighted output
  const highlightedOutput = useMemo(() => {
    if (!output) return [];
    return output.split('\n').slice(0, 10).map(line => highlightLine(line));
  }, [output]);

  const highlightedError = useMemo(() => {
    if (!error) return '';
    return highlightLine(error);
  }, [error]);

  return (
    <Box flexDirection="column" marginY={1}>
      {/* Command line */}
      <Box gap={1}>
        <Text color="#C678DD">$</Text>
        <Text color="#FFFFFF">{command}</Text>
        <Box flexGrow={1} />
        <StatusIcon status={status} />
        {duration !== undefined && (
          <>
            <Text color="#3E4451">•</Text>
            <Duration ms={duration} />
          </>
        )}
      </Box>

      {/* Output - syntax highlighted */}
      {showOutput && output && (
        <Box marginLeft={2} marginTop={1} flexDirection="column">
          {highlightedOutput.map((line, i) => (
            <Text key={i}>{line}</Text>
          ))}
          {output.split('\n').length > 10 && (
            <Text color="#5C6370">... {output.split('\n').length - 10} more lines</Text>
          )}
        </Box>
      )}

      {/* Error - highlighted */}
      {error && (
        <Box marginLeft={2} marginTop={1}>
          <Text>{highlightedError}</Text>
        </Box>
      )}
    </Box>
  );
});

// =============================================================================
// Step Progress (numbered steps)
// =============================================================================

export interface Step {
  label: string;
  status: ActionStatus;
  detail?: string;
}

export const StepProgress = memo(function StepProgress({
  steps,
  title,
}: {
  steps: Step[];
  title?: string;
}) {
  const currentIndex = steps.findIndex(s => s.status === 'running');
  const completedCount = steps.filter(s => s.status === 'success').length;

  return (
    <Box flexDirection="column" marginY={1}>
      {title && (
        <Box marginBottom={1}>
          <Text color="#61AFEF" bold>⚡ {title}</Text>
          <Text color="#5C6370"> ({completedCount}/{steps.length})</Text>
        </Box>
      )}

      {steps.map((step, index) => {
        const config = STATUS_CONFIG[step.status];
        const isLast = index === steps.length - 1;
        const connector = isLast ? '└' : '├';

        return (
          <Box key={index} gap={1}>
            <Text color="#3E4451">{connector}─</Text>
            <Text color={config.color}>
              {step.status === 'running' ? <Spinner color={config.color} /> : config.icon}
            </Text>
            <Text color={step.status === 'running' ? '#FFFFFF' : '#ABB2BF'}>
              {index + 1}. {step.label}
            </Text>
            {step.detail && (
              <Text color="#5C6370">— {step.detail}</Text>
            )}
          </Box>
        );
      })}
    </Box>
  );
});

// =============================================================================
// Test Results Display
// =============================================================================

export interface TestResult {
  name: string;
  status: 'pass' | 'fail' | 'skip';
  duration?: number;
  error?: string;
}

export const TestResults = memo(function TestResults({
  tests,
  title = 'Test Results',
}: {
  tests: TestResult[];
  title?: string;
}) {
  const passed = tests.filter(t => t.status === 'pass').length;
  const failed = tests.filter(t => t.status === 'fail').length;
  const skipped = tests.filter(t => t.status === 'skip').length;
  const totalDuration = tests.reduce((sum, t) => sum + (t.duration || 0), 0);

  const statusToAction: Record<string, ActionStatus> = {
    pass: 'success',
    fail: 'error',
    skip: 'skipped',
  };

  return (
    <Box flexDirection="column" marginY={1}>
      {/* Header with summary */}
      <Box gap={2} marginBottom={1}>
        <Text color="#61AFEF" bold>🧪 {title}</Text>
        <Text color="#98C379">{passed} passed</Text>
        {failed > 0 && <Text color="#E06C75">{failed} failed</Text>}
        {skipped > 0 && <Text color="#5C6370">{skipped} skipped</Text>}
        <Text color="#5C6370">│</Text>
        <Duration ms={totalDuration} />
      </Box>

      {/* Test list */}
      <Box flexDirection="column" marginLeft={2}>
        {tests.map((test, i) => {
          const status = statusToAction[test.status];
          const config = STATUS_CONFIG[status];

          return (
            <Box key={i} flexDirection="column">
              <Box gap={1}>
                <Text color={config.color}>{config.icon}</Text>
                <Text color={test.status === 'fail' ? '#E06C75' : '#ABB2BF'}>
                  {test.name}
                </Text>
                {test.duration && (
                  <>
                    <Box flexGrow={1} />
                    <Duration ms={test.duration} />
                  </>
                )}
              </Box>
              {test.error && (
                <Box marginLeft={3}>
                  <Text color="#E06C75" dimColor>└─ {test.error}</Text>
                </Box>
              )}
            </Box>
          );
        })}
      </Box>

      {/* Progress bar */}
      <Box marginTop={1} marginLeft={2} gap={1}>
        <Text color="#3E4451">[</Text>
        <Text color="#98C379">{'█'.repeat(Math.round(passed / tests.length * 20))}</Text>
        <Text color="#E06C75">{'█'.repeat(Math.round(failed / tests.length * 20))}</Text>
        <Text color="#5C6370">{'░'.repeat(Math.round(skipped / tests.length * 20))}</Text>
        <Text color="#3E4451">]</Text>
        <Text color="#ABB2BF">{Math.round(passed / tests.length * 100)}%</Text>
      </Box>
    </Box>
  );
});

// =============================================================================
// Live Log Stream
// =============================================================================

export const LogStream = memo(function LogStream({
  lines,
  maxLines = 10,
  title,
}: {
  lines: string[];
  maxLines?: number;
  title?: string;
}) {
  const visibleLines = lines.slice(-maxLines);

  // Memoize highlighted lines
  const highlightedLines = useMemo(() =>
    visibleLines.map(line => highlightLine(line)),
    [visibleLines]
  );

  return (
    <Box flexDirection="column" marginY={1}>
      {title && (
        <Box marginBottom={1}>
          <Text color="#61AFEF" bold>📋 {title}</Text>
        </Box>
      )}

      <Box
        flexDirection="column"
        borderStyle="single"
        borderColor="#3E4451"
        paddingX={1}
        paddingY={0}
      >
        {highlightedLines.map((line, i) => (
          <Text key={i}>{line}</Text>
        ))}
        {lines.length > maxLines && (
          <Text color="#5C6370" dimColor>↑ {lines.length - maxLines} more lines</Text>
        )}
      </Box>
    </Box>
  );
});

// =============================================================================
// Code Block with Full Syntax Highlighting
// =============================================================================

export const CodeBlock = memo(function CodeBlock({
  code,
  language = 'javascript',
  title,
  showLineNumbers = true,
}: {
  code: string;
  language?: string;
  title?: string;
  showLineNumbers?: boolean;
}) {
  const highlighted = useMemo(() => {
    try {
      return highlight(code, {
        language,
        ignoreIllegals: true,
        theme: syntaxTheme,
      }).split('\n');
    } catch {
      return code.split('\n');
    }
  }, [code, language]);

  return (
    <Box flexDirection="column" marginY={1}>
      {/* Header */}
      <Box>
        <Text color="#3E4451">╭─</Text>
        {title && <Text color="#546E7A"> {title} </Text>}
        {language && <Text color="#5C6370">({language})</Text>}
      </Box>

      {/* Code lines */}
      {highlighted.map((line, i) => (
        <Box key={i}>
          <Text color="#3E4451">│</Text>
          {showLineNumbers && (
            <Text color="#3E4451">{String(i + 1).padStart(3)} </Text>
          )}
          <Text>{line}</Text>
        </Box>
      ))}

      {/* Footer */}
      <Box>
        <Text color="#3E4451">╰─</Text>
      </Box>
    </Box>
  );
});

// =============================================================================
// Section Divider
// =============================================================================

export const Divider = memo(function Divider({ label }: { label?: string }) {
  if (label) {
    return (
      <Box marginY={1}>
        <Text color="#3E4451">──────</Text>
        <Text color="#5C6370"> {label} </Text>
        <Text color="#3E4451">──────────────────────────────</Text>
      </Box>
    );
  }

  return (
    <Box marginY={1}>
      <Text color="#3E4451">────────────────────────────────────────────</Text>
    </Box>
  );
});

export default {
  ActionRow,
  ActionList,
  CommandDisplay,
  StepProgress,
  TestResults,
  LogStream,
  Divider,
};
