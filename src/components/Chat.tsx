import { useState, useEffect, useRef, memo, useMemo } from 'react';
import { Box, Text, Static, useStdout } from 'ink';
import type { Message, ToolCall, ToolData } from '../types.js';
import { Markdown } from './Markdown.js';
import { ChartRenderer, hasChartData } from './charts/ChartRenderer.js';
import { COLORS } from '../theme/colors.js';

// ============================================================================
// Chat Container
// ============================================================================

interface ChatProps {
  messages: Message[];
  isStreaming?: boolean;
}

export const Chat = memo(function Chat({ messages }: ChatProps) {
  if (!messages.length) return null;

  // Separate completed messages from current streaming message
  // Static renders once and scrolls up, streaming message updates in place
  const completedMessages = messages.filter(m => !m.isStreaming);
  const streamingMessage = messages.find(m => m.isStreaming);

  return (
    <Box flexDirection="column">
      {/* Completed messages - rendered once via Static, scroll up naturally */}
      {completedMessages.length > 0 && (
        <Static items={completedMessages}>
          {(m) => <MessageItem key={m.id} message={m} />}
        </Static>
      )}
      {/* Currently streaming message - updates in place */}
      {streamingMessage && <MessageItem key={streamingMessage.id} message={streamingMessage} />}
    </Box>
  );
});

// ============================================================================
// Message Item
// ============================================================================

function MessageItem({ message }: { message: Message }) {
  const isUser = message.role === 'user';
  const hasTools = !isUser && message.toolCalls && message.toolCalls.length > 0;

  // Collect chart data from tool results, deduped by toolId
  const allChartData = useMemo(() => {
    if (!message.toolData?.length) return [];
    const charts: unknown[] = [];
    const seenToolIds = new Set<string>();

    for (const td of message.toolData) {
      // Dedupe by toolId - each tool result should only render once
      if (seenToolIds.has(td.toolId)) continue;
      seenToolIds.add(td.toolId);

      if (hasChartData(td.data)) {
        charts.push(td.data);
      }
    }
    return charts;
  }, [message.toolData]);

  const showText = !isUser && message.content?.trim();

  return (
    <Box flexDirection="column" gap={0} marginBottom={1}>
      {/* User message */}
      {isUser && (
        <Text>
          <Text color={COLORS.primary}>&gt; </Text>
          <Text color={COLORS.text}>{String(message.content || '')}</Text>
        </Text>
      )}

      {/* Tool calls */}
      {hasTools && (
        <Box flexDirection="column" gap={0}>
          {message.toolCalls!.map((tool) => (
            <ToolItem key={tool.id} tool={tool} />
          ))}
        </Box>
      )}

      {/* Charts - render ALL chart data from tools */}
      {allChartData.length > 0 && (
        <Box flexDirection="column" marginLeft={2} marginTop={1} gap={1}>
          {allChartData.map((data, i) => (
            <ChartRenderer key={i} data={data} />
          ))}
        </Box>
      )}

      {/* Assistant text */}
      {showText && (
        <Box marginTop={hasTools ? 1 : 0}>
          <Markdown streaming={message.isStreaming || false} skipMetrics={true}>
            {String(message.content)}
          </Markdown>
        </Box>
      )}
    </Box>
  );
}

// ============================================================================
// Tool Item - Claude Code Style with animated status dot
// ============================================================================

function ToolItem({ tool }: { tool: ToolCall }) {
  const [elapsed, setElapsed] = useState(0);
  const [frame, setFrame] = useState(0);
  const startRef = useRef(Date.now());
  const isRunning = tool.status === 'running';
  const isError = tool.status === 'error';
  const isDone = tool.status === 'completed';

  // Spinner frames for running state
  const spinFrames = ['*', '+', 'x', '+'];

  useEffect(() => {
    if (!isRunning) return;
    startRef.current = Date.now();
    const id = setInterval(() => {
      setElapsed((Date.now() - startRef.current) / 1000);
      setFrame(f => (f + 1) % spinFrames.length);
    }, 150); // Fast spin
    return () => clearInterval(id);
  }, [isRunning]);

  const { header, detail } = formatTool(tool);

  // Status indicator
  let statusChar: string;
  let statusColor: string;

  if (isRunning) {
    statusChar = spinFrames[frame];
    statusColor = COLORS.warning;
  } else if (isDone) {
    statusChar = '+';
    statusColor = COLORS.success;
  } else if (isError) {
    statusChar = '!';
    statusColor = COLORS.error;
  } else {
    statusChar = '?';
    statusColor = COLORS.textDim;
  }

  return (
    <Box flexDirection="column" gap={0}>
      {/* Header: [status] Action (path) */}
      <Text>
        <Text color={statusColor}>{statusChar}</Text>
        <Text> </Text>
        <Text bold color={COLORS.text}>{header}</Text>
        {detail && <Text color={COLORS.textMuted}> {detail}</Text>}
        {isRunning && elapsed > 0.5 && <Text color={COLORS.textDim}> {elapsed.toFixed(1)}s</Text>}
      </Text>

      {/* Result */}
      <ToolResult tool={tool} />
    </Box>
  );
}

// ============================================================================
// Tool Result
// ============================================================================

function ToolResult({ tool }: { tool: ToolCall }) {
  const { stdout } = useStdout();
  const width = stdout?.columns || 80;

  if (tool.status === 'running') return null;

  const r = tool.result;
  if (!r) return null;

  // Error
  if (tool.status === 'error' && r.error) {
    return (
      <Text color={COLORS.error}>       {String(r.error).slice(0, width - 10)}</Text>
    );
  }

  // Diff (Edit/Write) - Claude Code style with backgrounds
  if (r.diff && Array.isArray(r.diff) && r.diff.length > 0) {
    return <DiffResult diff={r.diff} summary={r.summary as string} width={width} />;
  }

  // File list (Glob, LS)
  if (r.files && Array.isArray(r.files)) {
    return <FileListResult files={r.files} width={width} path={r.path as string} isLong={r.long as boolean} />;
  }

  // File content (Read) - show line count and preview
  if (r.content && typeof r.content === 'string') {
    // Check if it's JSON that contains files (legacy glob format)
    try {
      const parsed = JSON.parse(r.content);
      if (parsed.files && Array.isArray(parsed.files)) {
        return <FileListResult files={parsed.files} width={width} />;
      }
    } catch {
      // Not JSON, treat as file content
    }

    const lineCount = r.lineCount || r.content.split('\n').length;
    const totalLines = r.totalLines;
    const lineInfo = totalLines && totalLines !== lineCount
      ? `${lineCount} of ${totalLines} lines`
      : `${lineCount} lines`;
    return (
      <Text color={COLORS.textDim}>       {lineInfo}</Text>
    );
  }

  // Bash output
  if (r.stdout || r.output) {
    const output = String(r.stdout || r.output || '');
    return <BashResult output={output} exitCode={r.exitCode as number} width={width} />;
  }

  // Grep matches
  if (r.matches && Array.isArray(r.matches)) {
    return <GrepResult matches={r.matches} width={width} />;
  }

  // Message
  if (r.message && typeof r.message === 'string') {
    return (
      <Text color={COLORS.textDim}>       {r.message}</Text>
    );
  }

  // Success with no specific output
  if (r.success) {
    return null; // Don't show "Done" - the [ok] status is enough
  }

  return null;
}

// ============================================================================
// Diff Result - Claude Code style: compact, colored backgrounds, no gaps
// ============================================================================

interface DiffLine {
  type: 'context' | 'add' | 'remove';
  content: string;
  lineNum?: number;
}

const DiffResult = memo(function DiffResult({
  diff, summary, width
}: {
  diff: DiffLine[];
  summary?: string;
  width: number;
}) {
  const maxLines = 25;
  const show = diff.slice(0, maxLines);
  const hidden = diff.length - maxLines;

  // Find max line number for width calculation
  const maxLineNum = Math.max(...show.map(l => l.lineNum || 0), 1);
  const lnWidth = Math.max(3, String(maxLineNum).length);
  // Leave margin for line number, sign, and some padding
  const maxContentWidth = Math.max(20, width - lnWidth - 12);

  return (
    <Box flexDirection="column" marginLeft={2} gap={0}>
      {/* Summary */}
      {summary && <Text color={COLORS.textMuted}>  {summary}</Text>}

      {/* Diff lines - background only covers actual content, not full width */}
      {show.map((line, i) => {
        const ln = line.lineNum ? String(line.lineNum).padStart(lnWidth) : ' '.repeat(lnWidth);
        // Truncate content if needed, but don't pad
        const content = line.content.length > maxContentWidth
          ? line.content.slice(0, maxContentWidth - 3) + '...'
          : line.content;

        if (line.type === 'add') {
          return (
            <Text key={i}>
              <Text color={COLORS.textDim}> {ln} </Text>
              <Text backgroundColor="#0d2818" color="#3fb950">+{content}</Text>
            </Text>
          );
        } else if (line.type === 'remove') {
          return (
            <Text key={i}>
              <Text color={COLORS.textDim}> {ln} </Text>
              <Text backgroundColor="#2d1216" color="#f85149">-{content}</Text>
            </Text>
          );
        } else {
          return (
            <Text key={i} color={COLORS.textDim}>
              {' '}{ln}  {content}
            </Text>
          );
        }
      })}

      {/* Hidden indicator */}
      {hidden > 0 && <Text color={COLORS.textVeryDim}>  ... {hidden} more lines</Text>}
    </Box>
  );
});

// ============================================================================
// File List Result (Glob)
// ============================================================================

const FileListResult = memo(function FileListResult({
  files, width, path, isLong
}: {
  files: string[];
  width: number;
  path?: string;
  isLong?: boolean;
}) {
  if (files.length === 0) {
    return (
      <Text color={COLORS.textDim}>       no files found</Text>
    );
  }

  // Show more files for directory listings (they're usually shorter)
  const maxShow = isLong ? 12 : 10;
  const show = files.slice(0, maxShow);
  const hidden = files.length - show.length;

  // For long format, files already include details - just show them
  if (isLong) {
    return (
      <Box flexDirection="column" gap={0}>
        <Text color={COLORS.textDim}>       {files.length} items</Text>
        {show.map((file, i) => (
          <Text key={i} color={COLORS.textVeryDim}>
            {'         '}{file.length > width - 12 ? file.slice(0, width - 15) + '...' : file}
          </Text>
        ))}
        {hidden > 0 && (
          <Text color={COLORS.textVeryDim}>
            {'         '}+{hidden} more
          </Text>
        )}
      </Box>
    );
  }

  // For simple listings, show files in a compact grid-like format if short
  const avgLen = files.reduce((s, f) => s + f.length, 0) / files.length;
  const useCompact = avgLen < 25 && files.length <= 20;

  if (useCompact && files.length > 1) {
    // Compact: show multiple per line
    const cols = Math.floor((width - 10) / 30) || 1;
    const rows: string[][] = [];
    for (let i = 0; i < files.length; i += cols) {
      rows.push(files.slice(i, i + cols));
    }
    const showRows = rows.slice(0, 6);
    const hiddenCount = files.length - showRows.flat().length;

    return (
      <Box flexDirection="column" gap={0}>
        <Text color={COLORS.textDim}>       {files.length} items</Text>
        {showRows.map((row, i) => (
          <Text key={i} color={COLORS.textVeryDim}>
            {'         '}{row.map(f => f.padEnd(28)).join(' ')}
          </Text>
        ))}
        {hiddenCount > 0 && (
          <Text color={COLORS.textVeryDim}>
            {'         '}+{hiddenCount} more
          </Text>
        )}
      </Box>
    );
  }

  // Standard: one per line
  return (
    <Box flexDirection="column" gap={0}>
      <Text color={COLORS.textDim}>       {files.length} {files.length === 1 ? 'item' : 'items'}</Text>
      {show.map((file, i) => (
        <Text key={i} color={COLORS.textVeryDim}>
          {'         '}{truncatePath(file, width - 12)}
        </Text>
      ))}
      {hidden > 0 && (
        <Text color={COLORS.textVeryDim}>
          {'         '}+{hidden} more
        </Text>
      )}
    </Box>
  );
});

// ============================================================================
// Grep Result
// ============================================================================

const GrepResult = memo(function GrepResult({
  matches, width
}: {
  matches: Array<{ file: string; line?: number; content?: string }>;
  width: number;
}) {
  const show = matches.slice(0, 10);
  const hidden = matches.length - show.length;

  // Calculate how much space for content preview
  const pathWidth = Math.min(40, width / 2);
  const contentWidth = width - pathWidth - 15;

  return (
    <Box flexDirection="column" gap={0}>
      <Text color={COLORS.textDim}>       {matches.length} {matches.length === 1 ? 'match' : 'matches'}</Text>
      {show.map((m, i) => {
        const filePart = truncatePath(m.file, pathWidth - 5);
        const linePart = m.line ? `:${m.line}` : '';
        const contentPart = m.content
          ? ` ${m.content.trim().slice(0, contentWidth)}`
          : '';
        return (
          <Text key={i}>
            <Text color={COLORS.textVeryDim}>{'         '}</Text>
            <Text color={COLORS.textMuted}>{filePart}{linePart}</Text>
            <Text color={COLORS.textVeryDim}>{contentPart}</Text>
          </Text>
        );
      })}
      {hidden > 0 && (
        <Text color={COLORS.textVeryDim}>
          {'         '}+{hidden} more
        </Text>
      )}
    </Box>
  );
});

// ============================================================================
// Bash Result
// ============================================================================

const BashResult = memo(function BashResult({
  output, exitCode, width
}: {
  output: string;
  exitCode?: number;
  width: number;
}) {
  const lines = output.trim().split('\n');
  const maxLines = 15;
  const show = lines.slice(0, maxLines);
  const hidden = lines.length - maxLines;
  const failed = exitCode !== undefined && exitCode !== 0;

  return (
    <Box flexDirection="column" gap={0}>
      {show.map((line, i) => {
        const displayLine = line.length > width - 10 ? line.slice(0, width - 13) + '...' : line;
        return (
          <Text key={i} color={failed ? COLORS.error : COLORS.textDim}>
            {'         '}{displayLine}
          </Text>
        );
      })}
      {hidden > 0 && (
        <Text color={COLORS.textVeryDim}>
          {'         '}+{hidden} more lines
        </Text>
      )}
    </Box>
  );
});

// ============================================================================
// Formatting Helpers
// ============================================================================

function formatTool(tool: ToolCall): { header: string; detail?: string } {
  const name = tool.name?.toLowerCase() || '';
  const input = tool.input || {};

  switch (name) {
    case 'read':
      return { header: 'Read', detail: truncatePath(String(input.file_path || '')) };

    case 'edit':
      return { header: 'Update', detail: truncatePath(String(input.file_path || '')) };

    case 'write':
      return { header: 'Write', detail: truncatePath(String(input.file_path || '')) };

    case 'bash': {
      const cmd = String(input.command || '');
      const short = cmd.length > 50 ? cmd.slice(0, 47) + '…' : cmd;
      return { header: 'Bash', detail: short };
    }

    case 'glob':
      return { header: 'Glob', detail: String(input.pattern || '') };

    case 'grep':
      return { header: 'Grep', detail: `/${String(input.pattern || '')}/` };

    case 'ls':
      return { header: 'List', detail: truncatePath(String(input.path || '.')) };

    case 'todowrite':
      return { header: 'TodoWrite', detail: `${(input.todos as unknown[])?.length || 0} items` };

    case 'task':
      return { header: 'Task', detail: String(input.description || '') };

    default:
      return { header: name.charAt(0).toUpperCase() + name.slice(1) };
  }
}

function truncatePath(path: string, max: number = 60): string {
  if (!path) return '';

  // Replace home directory
  const home = process.env.HOME || '';
  let p = path.startsWith(home) ? '~' + path.slice(home.length) : path;

  if (p.length <= max) return p;

  // Show …/parent/file
  const parts = p.split('/');
  const file = parts.pop() || '';
  const parent = parts.pop() || '';
  return `…/${parent}/${file}`.slice(0, max);
}
