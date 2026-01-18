import { useState, useEffect, useRef, memo, useMemo } from 'react';
import { Box, Text, Static } from 'ink';
import { highlight } from 'cli-highlight';
import chalk from 'chalk';
import type { Message, ToolCall, ToolData } from '../types.js';
import { Markdown } from './Markdown.js';
import { ChartRenderer, hasChartData } from './charts/ChartRenderer.js';

const SPINNER = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

// Syntax highlighting theme
const theme = {
  keyword: chalk.hex('#C792EA'),
  built_in: chalk.hex('#82AAFF'),
  type: chalk.hex('#FFCB6B'),
  literal: chalk.hex('#F78C6C'),
  number: chalk.hex('#F78C6C'),
  string: chalk.hex('#C3E88D'),
  comment: chalk.hex('#546E7A'),
  function: chalk.hex('#82AAFF'),
  operator: chalk.hex('#89DDFF'),
};

interface DiffLine {
  type: 'context' | 'add' | 'remove';
  content: string;
  lineNum?: number;
}

interface ChatProps {
  messages: Message[];
  isStreaming?: boolean;
}

export const Chat = memo(function Chat({ messages }: ChatProps) {
  if (!messages.length) return null;

  // Split messages: static (completed) vs dynamic (streaming/last)
  const { staticMessages, dynamicMessages } = useMemo(() => {
    // All messages except the last assistant message go to static
    // The last message (if streaming or assistant) stays dynamic
    const lastIdx = messages.length - 1;
    const lastMsg = messages[lastIdx];

    // If last message is streaming, keep it dynamic
    if (lastMsg?.isStreaming) {
      return {
        staticMessages: messages.slice(0, -1),
        dynamicMessages: [lastMsg],
      };
    }

    // Otherwise all messages are static (fully rendered)
    return {
      staticMessages: messages,
      dynamicMessages: [],
    };
  }, [messages]);

  return (
    <Box flexDirection="column">
      {/* Static messages - rendered once, never re-render */}
      {staticMessages.length > 0 && (
        <Static items={staticMessages}>
          {(m, i) => (
            <MessageItem key={m.id} message={m} isLast={false} />
          )}
        </Static>
      )}

      {/* Dynamic message - the one currently streaming */}
      {dynamicMessages.map((m) => (
        <MessageItem key={m.id} message={m} isLast={true} />
      ))}
    </Box>
  );
});

const MessageItem = memo(function MessageItem({ message, isLast }: { message: Message; isLast?: boolean }) {
  const isUser = message.role === 'user';
  const hasTools = !isUser && message.toolCalls && message.toolCalls.length > 0;

  // Get first chart data only (dedupe by taking first)
  const chartData = useMemo(() => {
    if (!message.toolData?.length) return null;
    const first = message.toolData.find(td => hasChartData(td.data));
    return first ? first.data : null;
  }, [message.toolData]);

  // Only show text if NO chart (chart replaces verbose text)
  const showText = !isUser && message.content?.trim() && !chartData;

  return (
    <Box flexDirection="column" marginBottom={isLast ? 0 : 2}>
      {/* User message */}
      {isUser && (
        <Box marginBottom={1}>
          <Text color="#7DC87D" bold>❯ </Text>
          <Text color="#E8E8E8">{String(message.content || '')}</Text>
        </Box>
      )}

      {/* Tool status */}
      {hasTools && (
        <Box flexDirection="column" marginLeft={2}>
          {message.toolCalls!.map((t, i) => (
            <ToolItem key={`${t.id}-${i}`} tool={t} isFirst={i === 0} />
          ))}
        </Box>
      )}

      {/* Single chart from tool result */}
      {chartData && (
        <Box marginLeft={2} marginTop={hasTools ? 1 : 0}>
          <ChartRenderer data={chartData} />
        </Box>
      )}

      {/* Assistant text - only if no chart */}
      {showText && (
        <Box marginTop={hasTools ? 1 : 0} marginLeft={2}>
          <StreamingText text={String(message.content)} isStreaming={message.isStreaming || false} skipMetrics={true} />
        </Box>
      )}
    </Box>
  );
});

const ToolItem = memo(function ToolItem({ tool, isFirst }: { tool: ToolCall; isFirst?: boolean }) {
  const [frame, setFrame] = useState(0);
  const startRef = useRef(Date.now());
  const isRunning = tool.status === 'running';

  useEffect(() => {
    if (!isRunning) return;
    startRef.current = Date.now();
    const id = setInterval(() => setFrame(f => (f + 1) % SPINNER.length), 120);
    return () => clearInterval(id);
  }, [isRunning]);

  const elapsed = isRunning ? ((Date.now() - startRef.current) / 1000) : 0;
  const icon = isRunning ? SPINNER[frame] : tool.status === 'completed' ? '✓' : tool.status === 'error' ? '✗' : '○';
  const iconColor = isRunning ? '#FFCB6B' : tool.status === 'completed' ? '#7DC87D' : tool.status === 'error' ? '#E07070' : '#555';

  const { label, preview, previewLang } = formatToolInfo(tool.name, tool.input);
  const { output, outputLang } = formatToolOutput(tool);
  const err = tool.status === 'error' && tool.result?.error;
  const diff = tool.status === 'completed' && tool.result?.diff;

  return (
    <Box flexDirection="column" marginTop={isFirst ? 0 : 1}>
      {/* Tool header */}
      <Box>
        <Text color={iconColor}>{icon} </Text>
        <Text color="#89DDFF">{label}</Text>
        {isRunning && elapsed > 0.5 && <Text color="#555"> {elapsed.toFixed(1)}s</Text>}
      </Box>

      {/* Input preview (SQL, code, etc.) */}
      {preview && (
        <Box marginLeft={2} marginTop={1}>
          <CodePreview code={preview} lang={previewLang} maxLines={6} />
        </Box>
      )}

      {/* Output with syntax highlighting */}
      {output && !diff && (
        <Box marginLeft={2} marginTop={1}>
          <CodePreview code={output} lang={outputLang} maxLines={10} label="Output" />
        </Box>
      )}

      {/* Error */}
      {err && (
        <Box marginLeft={2} marginTop={1}>
          <Box flexDirection="column">
            <Text color="#E07070" bold>Error:</Text>
            <Text color="#E07070">{String(err).slice(0, 200)}</Text>
          </Box>
        </Box>
      )}

      {/* Diff view */}
      {diff && (
        <Box marginLeft={2} marginTop={1}>
          <DiffView diff={diff} file={tool.result!.file} summary={tool.result!.summary} collapsed={diff.length > 8} />
        </Box>
      )}
    </Box>
  );
});

// Backend tool data item - renders charts/tables from structured results
const ToolDataItem = memo(function ToolDataItem({ toolData, isFirst }: { toolData: ToolData; isFirst?: boolean }) {
  const { toolName, data, elapsed_ms, isError } = toolData;

  // Check if data has chart-renderable content
  const chartable = data && hasChartData(data);

  // Format tool name for display
  const label = toolName.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());

  return (
    <Box flexDirection="column" marginTop={isFirst ? 0 : 1}>
      {/* Header for backend tool result */}
      <Box>
        <Text color={isError ? '#E07070' : '#7DC87D'}>
          {isError ? '✗' : '◆'}{' '}
        </Text>
        <Text color="#82AAFF">{label}</Text>
        {elapsed_ms && <Text color="#555"> {(elapsed_ms / 1000).toFixed(1)}s</Text>}
      </Box>

      {/* Render chart if data supports it */}
      {chartable && (
        <Box marginLeft={2} marginTop={1}>
          <ChartRenderer data={data} fallbackTitle={label} />
        </Box>
      )}

      {/* Error display */}
      {isError && typeof data === 'string' && (
        <Box marginLeft={2} marginTop={1}>
          <Text color="#E07070">{String(data).slice(0, 300)}</Text>
        </Box>
      )}
    </Box>
  );
});

// Format tool info with preview detection
function formatToolInfo(name: string, input: Record<string, unknown>): { label: string; preview?: string; previewLang?: string } {
  const n = name?.toLowerCase() || '';

  if (n === 'read') {
    const file = String(input?.file_path || '').split('/').pop() || '';
    return { label: `Read ${file}` };
  }

  if (n === 'edit') {
    const file = String(input?.file_path || '').split('/').pop() || '';
    const oldStr = input?.old_string as string;
    const newStr = input?.new_string as string;
    // Show the change as a preview
    if (oldStr && newStr) {
      const preview = `- ${oldStr.split('\n').slice(0, 3).join('\n- ')}\n+ ${newStr.split('\n').slice(0, 3).join('\n+ ')}`;
      return { label: `Edit ${file}`, preview, previewLang: detectLang(file) };
    }
    return { label: `Edit ${file}` };
  }

  if (n === 'write') {
    const file = String(input?.file_path || '').split('/').pop() || '';
    const content = input?.content as string;
    if (content) {
      const preview = content.split('\n').slice(0, 8).join('\n');
      return { label: `Write ${file}`, preview, previewLang: detectLang(file) };
    }
    return { label: `Write ${file}` };
  }

  if (n === 'bash') {
    const cmd = String(input?.command || '');
    // Detect SQL in bash commands
    if (isSqlCommand(cmd)) {
      const sql = extractSql(cmd);
      return { label: '$ psql', preview: sql, previewLang: 'sql' };
    }
    // Show command preview for longer commands
    if (cmd.length > 60) {
      return { label: '$ bash', preview: cmd, previewLang: 'bash' };
    }
    const short = cmd.length > 50 ? cmd.slice(0, 47) + '...' : cmd;
    return { label: `$ ${short}` };
  }

  if (n === 'glob') return { label: `Glob "${input?.pattern || ''}"` };
  if (n === 'grep') return { label: `Grep "${String(input?.pattern || '').slice(0, 25)}"` };
  if (n === 'todowrite') return { label: `Update tasks (${(input?.todos as unknown[])?.length || 0})` };

  return { label: name || 'Unknown' };
}

// Format tool output
function formatToolOutput(tool: ToolCall): { output?: string; outputLang?: string } {
  if (tool.status !== 'completed' || !tool.result) return {};
  const r = tool.result;

  // Skip if there's a diff (handled separately)
  if (r.diff) return {};

  // File content output
  if (typeof r.content === 'string' && r.content.length > 0) {
    const lines = r.content.split('\n');
    if (lines.length > 1) {
      // Detect if it's SQL output (table format)
      if (r.content.includes('|') && r.content.includes('-+-')) {
        return { output: r.content, outputLang: 'sql' };
      }
      // JSON output
      if (r.content.trim().startsWith('{') || r.content.trim().startsWith('[')) {
        return { output: r.content, outputLang: 'json' };
      }
      // Generic output
      return { output: r.content, outputLang: 'text' };
    }
  }

  // Files list
  if (Array.isArray(r.files) && r.files.length > 0) {
    const fileList = r.files.slice(0, 15).join('\n');
    const more = r.files.length > 15 ? `\n... ${r.files.length - 15} more` : '';
    return { output: fileList + more, outputLang: 'text' };
  }

  // Simple message
  if (typeof r.message === 'string') {
    return { output: r.message };
  }

  return {};
}

// Detect if command contains SQL
function isSqlCommand(cmd: string): boolean {
  const sqlKeywords = /\b(SELECT|INSERT|UPDATE|DELETE|CREATE|ALTER|DROP|TRUNCATE|WITH|FROM|WHERE|JOIN|GROUP BY|ORDER BY)\b/i;
  return sqlKeywords.test(cmd);
}

// Extract SQL from a bash command
function extractSql(cmd: string): string {
  // Try to extract SQL from psql -c "..." or similar
  const match = cmd.match(/(?:-c\s+['"]|<<['"]?EOF['"]?\n?)([\s\S]*?)(?:['"]|EOF)/i);
  if (match) return match[1].trim();

  // If the command itself looks like SQL
  if (/^\s*(SELECT|INSERT|UPDATE|DELETE|CREATE|ALTER|DROP|WITH)/i.test(cmd)) {
    return cmd;
  }

  return cmd;
}

// Detect language from filename
function detectLang(filename: string): string {
  const ext = filename.split('.').pop()?.toLowerCase() || '';
  const langMap: Record<string, string> = {
    sql: 'sql', ts: 'typescript', tsx: 'typescript', js: 'javascript', jsx: 'javascript',
    py: 'python', rb: 'ruby', go: 'go', rs: 'rust', json: 'json', yaml: 'yaml',
    yml: 'yaml', md: 'markdown', sh: 'bash', bash: 'bash', zsh: 'bash',
    html: 'html', css: 'css', scss: 'scss', swift: 'swift',
  };
  return langMap[ext] || 'text';
}

// Code preview component with syntax highlighting
const CodePreview = memo(function CodePreview({
  code, lang, maxLines = 10, label
}: { code: string; lang?: string; maxLines?: number; label?: string }) {
  const lines = code.split('\n');
  const truncated = lines.length > maxLines;
  const showLines = truncated ? lines.slice(0, maxLines) : lines;
  const showCode = showLines.join('\n');

  let highlighted: string;
  try {
    highlighted = highlight(showCode, { language: lang || 'text', ignoreIllegals: true, theme });
  } catch {
    highlighted = showCode;
  }

  const hlLines = highlighted.split('\n');

  return (
    <Box flexDirection="column">
      <Box>
        <Text color="#444">╭─</Text>
        {lang && <Text color="#546E7A"> {lang} </Text>}
        {label && <Text color="#546E7A">{label} </Text>}
      </Box>
      {hlLines.map((line, i) => (
        <Box key={i}>
          <Text color="#444">│</Text>
          <Text color="#3A3A3A">{String(i + 1).padStart(3)} </Text>
          <Text>{line}</Text>
        </Box>
      ))}
      {truncated && (
        <Box>
          <Text color="#444">│</Text>
          <Text color="#546E7A">    ... {lines.length - maxLines} more lines</Text>
        </Box>
      )}
      <Box>
        <Text color="#444">╰─</Text>
      </Box>
    </Box>
  );
});

// Diff view with syntax highlighting
const DiffView = memo(function DiffView({
  diff, file, summary, collapsed
}: { diff: DiffLine[]; file?: string; summary?: string; collapsed?: boolean }) {
  const show = collapsed ? diff.slice(0, 6) : diff.slice(0, 25);
  const hidden = collapsed ? diff.length - 6 : Math.max(0, diff.length - 25);

  return (
    <Box flexDirection="column">
      {/* Header */}
      <Box>
        <Text color="#444">╭─</Text>
        {file && <Text color="#82AAFF"> {file.split('/').pop()} </Text>}
        {summary && <Text color="#546E7A">({summary})</Text>}
      </Box>

      {/* Diff lines */}
      {show.map((l, i) => {
        const ln = l.lineNum ? String(l.lineNum).padStart(3) : '   ';
        if (l.type === 'remove') {
          return (
            <Box key={i}>
              <Text color="#444">│</Text>
              <Text color="#444">{ln} </Text>
              <Text color="#E07070" bold>- </Text>
              <Text color="#E07070">{l.content}</Text>
            </Box>
          );
        }
        if (l.type === 'add') {
          return (
            <Box key={i}>
              <Text color="#444">│</Text>
              <Text color="#444">    </Text>
              <Text color="#7DC87D" bold>+ </Text>
              <Text color="#7DC87D">{l.content}</Text>
            </Box>
          );
        }
        return (
          <Box key={i}>
            <Text color="#444">│</Text>
            <Text color="#3A3A3A">{ln}   </Text>
            <Text color="#666">{l.content}</Text>
          </Box>
        );
      })}

      {/* Hidden count */}
      {hidden > 0 && (
        <Box>
          <Text color="#444">│</Text>
          <Text color="#546E7A">    ... {hidden} more lines</Text>
        </Box>
      )}

      {/* Footer */}
      <Box>
        <Text color="#444">╰─</Text>
      </Box>
    </Box>
  );
});

// Streaming text with real-time markdown rendering
const StreamingText = memo(function StreamingText({ text, isStreaming, skipMetrics }: { text: string; isStreaming: boolean; skipMetrics?: boolean }) {
  return (
    <Box flexDirection="column">
      <Markdown streaming={isStreaming} skipMetrics={skipMetrics}>{text}</Markdown>
    </Box>
  );
});
