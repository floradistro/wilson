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

  const { staticMessages, dynamicMessage } = useMemo(() => {
    const lastIdx = messages.length - 1;
    const lastMsg = messages[lastIdx];

    if (lastMsg?.isStreaming) {
      return {
        staticMessages: messages.slice(0, -1),
        dynamicMessage: lastMsg,
      };
    }

    return { staticMessages: messages, dynamicMessage: null };
  }, [messages]);

  return (
    <Box flexDirection="column">
      {staticMessages.length > 0 && (
        <Static items={staticMessages}>
          {(m) => <MessageItem key={m.id} message={m} />}
        </Static>
      )}
      {dynamicMessage && <MessageItem key={dynamicMessage.id} message={dynamicMessage} />}
    </Box>
  );
});

// ============================================================================
// Message Item
// ============================================================================

const MessageItem = memo(function MessageItem({ message }: { message: Message }) {
  const isUser = message.role === 'user';
  const hasTools = !isUser && message.toolCalls && message.toolCalls.length > 0;

  const chartData = useMemo(() => {
    if (!message.toolData?.length) return null;
    const first = message.toolData.find(td => hasChartData(td.data));
    return first ? first.data : null;
  }, [message.toolData]);

  const showText = !isUser && message.content?.trim() && !chartData;

  return (
    <Box flexDirection="column" marginBottom={1}>
      {/* User message */}
      {isUser && (
        <Text>
          <Text color={COLORS.textMuted}>&gt; </Text>
          <Text color={COLORS.text}>{String(message.content || '')}</Text>
        </Text>
      )}

      {/* Tool calls */}
      {hasTools && (
        <Box flexDirection="column">
          {message.toolCalls!.map((tool) => (
            <ToolItem key={tool.id} tool={tool} />
          ))}
        </Box>
      )}

      {/* Charts */}
      {chartData && (
        <Box marginLeft={2} marginTop={1}>
          <ChartRenderer data={chartData} />
        </Box>
      )}

      {/* Assistant text */}
      {showText && (
        <Box marginTop={hasTools ? 1 : 0} marginLeft={2}>
          <Markdown streaming={message.isStreaming || false} skipMetrics={true}>
            {String(message.content)}
          </Markdown>
        </Box>
      )}
    </Box>
  );
});

// ============================================================================
// Tool Item - Claude Code Style with animated status dot
// ============================================================================

const ToolItem = memo(function ToolItem({ tool }: { tool: ToolCall }) {
  const [elapsed, setElapsed] = useState(0);
  const [blink, setBlink] = useState(true);
  const startRef = useRef(Date.now());
  const isRunning = tool.status === 'running';
  const isError = tool.status === 'error';
  const isDone = tool.status === 'completed';

  useEffect(() => {
    if (!isRunning) return;
    startRef.current = Date.now();
    const id = setInterval(() => {
      setElapsed((Date.now() - startRef.current) / 1000);
      setBlink(b => !b); // Toggle blink
    }, 400); // Blink every 400ms
    return () => clearInterval(id);
  }, [isRunning]);

  // Animated dot for running, solid for completed/error
  const dotColor = isRunning
    ? (blink ? COLORS.warning : COLORS.textDim) // Blink yellow/dim
    : isDone
      ? COLORS.success
      : isError
        ? COLORS.error
        : COLORS.textDim;

  const { header, detail } = formatTool(tool);

  return (
    <Box flexDirection="column" marginTop={1}>
      {/* Header: ● Action(path) */}
      <Text>
        <Text color={dotColor}>●</Text>
        <Text> </Text>
        <Text bold>{header}</Text>
        {detail && <Text color={COLORS.textMuted}>({detail})</Text>}
        {isRunning && elapsed > 0.5 && <Text color={COLORS.textDim}> {elapsed.toFixed(1)}s</Text>}
      </Text>

      {/* Result */}
      <ToolResult tool={tool} />
    </Box>
  );
});

// ============================================================================
// Tool Result
// ============================================================================

const ToolResult = memo(function ToolResult({ tool }: { tool: ToolCall }) {
  const { stdout } = useStdout();
  const width = stdout?.columns || 80;

  if (tool.status === 'running') return null;

  const r = tool.result;
  if (!r) return null;

  // Error
  if (tool.status === 'error' && r.error) {
    return (
      <Text>
        <Text color={COLORS.textDim}> └ </Text>
        <Text color={COLORS.error}>{String(r.error).slice(0, width - 10)}</Text>
      </Text>
    );
  }

  // Diff (Edit/Write) - Claude Code style with backgrounds
  if (r.diff && Array.isArray(r.diff) && r.diff.length > 0) {
    return <DiffResult diff={r.diff} summary={r.summary as string} width={width} />;
  }

  // File content (Read)
  if (r.content && typeof r.content === 'string') {
    const lines = r.content.split('\n');
    const lineCount = r.lineCount || lines.length;
    return (
      <Text>
        <Text color={COLORS.textDim}> └ </Text>
        <Text color={COLORS.textMuted}>Read {lineCount} lines</Text>
      </Text>
    );
  }

  // File list (Glob)
  if (r.files && Array.isArray(r.files)) {
    return <FileListResult files={r.files} width={width} />;
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
      <Text>
        <Text color={COLORS.textDim}> └ </Text>
        <Text color={COLORS.textMuted}>{r.message}</Text>
      </Text>
    );
  }

  // Success with no specific output
  if (r.success) {
    return (
      <Text>
        <Text color={COLORS.textDim}> └ </Text>
        <Text color={COLORS.textMuted}>Done</Text>
      </Text>
    );
  }

  return null;
});

// ============================================================================
// Diff Result - Claude Code style: compact, colored backgrounds
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
  const maxLines = 20;
  const show = diff.slice(0, maxLines);
  const hidden = diff.length - maxLines;

  // Find max line number for width calculation
  const maxLineNum = Math.max(...show.map(l => l.lineNum || 0), 1);
  const lnWidth = Math.max(3, String(maxLineNum).length);
  const contentWidth = width - lnWidth - 4; // "123 + "

  return (
    <Box flexDirection="column">
      {/* Summary line */}
      {summary && (
        <Text color={COLORS.textMuted}>  ⎿ {summary}</Text>
      )}

      {/* Diff lines - NO Box wrapper, just Text for compactness */}
      {show.map((line, i) => {
        const ln = line.lineNum ? String(line.lineNum).padStart(lnWidth) : ' '.repeat(lnWidth);
        const content = line.content.slice(0, contentWidth);

        if (line.type === 'add') {
          // Green background, green text - full line
          const padded = (ln + ' + ' + content).padEnd(width);
          return <Text key={i} backgroundColor="#1e3a1e" color="#98c379">{padded}</Text>;
        }

        if (line.type === 'remove') {
          // Red background, red text - full line
          const padded = (ln + ' - ' + content).padEnd(width);
          return <Text key={i} backgroundColor="#3a1e1e" color="#e06c75">{padded}</Text>;
        }

        // Context line - dim, no background
        return <Text key={i} color={COLORS.textDim}>{ln}   {content}</Text>;
      })}

      {/* Collapsed indicator */}
      {hidden > 0 && <Text color={COLORS.textVeryDim}>  … {hidden} more</Text>}
    </Box>
  );
});

// ============================================================================
// File List Result (Glob)
// ============================================================================

const FileListResult = memo(function FileListResult({
  files, width
}: {
  files: string[];
  width: number;
}) {
  if (files.length === 0) {
    return (
      <Text>
        <Text color={COLORS.textDim}> └ </Text>
        <Text color={COLORS.textMuted}>No files found</Text>
      </Text>
    );
  }

  const show = files.slice(0, 10);
  const hidden = files.length - show.length;

  return (
    <Box flexDirection="column">
      <Text>
        <Text color={COLORS.textDim}> └ </Text>
        <Text color={COLORS.textMuted}>Found {files.length} files</Text>
      </Text>
      {show.map((file, i) => (
        <Text key={i} color={COLORS.textDim}>
          {'   '}{truncatePath(file, width - 6)}
        </Text>
      ))}
      {hidden > 0 && (
        <Text color={COLORS.textVeryDim}>
          {'   '}… {hidden} more
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
  const show = matches.slice(0, 8);
  const hidden = matches.length - show.length;

  return (
    <Box flexDirection="column">
      <Text>
        <Text color={COLORS.textDim}> └ </Text>
        <Text color={COLORS.textMuted}>Found {matches.length} matches</Text>
      </Text>
      {show.map((m, i) => (
        <Text key={i} color={COLORS.textDim}>
          {'   '}{truncatePath(m.file, width - 6)}{m.line ? `:${m.line}` : ''}
        </Text>
      ))}
      {hidden > 0 && (
        <Text color={COLORS.textVeryDim}>
          {'   '}… {hidden} more
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
    <Box flexDirection="column">
      {show.map((line, i) => {
        const displayLine = line.length > width - 4 ? line.slice(0, width - 5) + '…' : line;
        return (
          <Text key={i}>
            <Text color={COLORS.textDim}>{i === 0 ? ' └ ' : '   '}</Text>
            <Text color={failed ? COLORS.error : COLORS.textMuted}>{displayLine}</Text>
          </Text>
        );
      })}
      {hidden > 0 && (
        <Text color={COLORS.textVeryDim}>
          {'   '}… {hidden} more lines
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
