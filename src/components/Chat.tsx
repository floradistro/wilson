import { useState, useEffect, useRef, memo } from 'react';
import { Box, Text } from 'ink';
import type { Message, ToolCall } from '../types.js';
import { Markdown } from './Markdown.js';

const SPINNER = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

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
  return (
    <Box flexDirection="column">
      {messages.map((m, i) => <MessageItem key={m.id} message={m} isLast={i === messages.length - 1} />)}
    </Box>
  );
});

const MessageItem = memo(function MessageItem({ message, isLast }: { message: Message; isLast?: boolean }) {
  const isUser = message.role === 'user';
  const hasTools = !isUser && message.toolCalls?.length > 0;
  const hasContent = !isUser && message.content;

  return (
    <Box flexDirection="column" marginBottom={isLast ? 0 : 1}>
      {/* User message */}
      {isUser && (
        <Box>
          <Text color="#7DC87D" bold>&gt; </Text>
          <Text color="#E0E0E0">{String(message.content || '')}</Text>
        </Box>
      )}

      {/* Tool calls - compact inline display */}
      {hasTools && (
        <Box flexDirection="column">
          {message.toolCalls!.map((t, i) => <ToolItem key={`${t.id}-${i}`} tool={t} />)}
        </Box>
      )}

      {/* Assistant text - with top margin if tools shown */}
      {hasContent && (
        <Box marginTop={hasTools ? 1 : 0}>
          <Markdown>{String(message.content)}</Markdown>
        </Box>
      )}
    </Box>
  );
});

const ToolItem = memo(function ToolItem({ tool }: { tool: ToolCall }) {
  const [frame, setFrame] = useState(0);
  const startRef = useRef(Date.now());
  const isRunning = tool.status === 'running';

  useEffect(() => {
    if (!isRunning) return;
    startRef.current = Date.now();
    const id = setInterval(() => setFrame(f => (f + 1) % 10), 80);
    return () => clearInterval(id);
  }, [isRunning]);

  const elapsed = isRunning ? ((Date.now() - startRef.current) / 1000) : 0;
  const icon = isRunning ? SPINNER[frame] : tool.status === 'completed' ? '✓' : tool.status === 'error' ? '✗' : '○';
  const color = isRunning ? '#7DC87D' : tool.status === 'completed' ? '#7DC87D' : tool.status === 'error' ? '#E07070' : '#666';
  const label = fmtTool(tool.name, tool.input);
  const result = tool.status === 'completed' && tool.result ? fmtResult(tool.result) : null;
  const err = tool.status === 'error' && tool.result?.error;
  const diff = tool.status === 'completed' && tool.result?.diff;

  return (
    <Box flexDirection="column">
      <Box>
        <Text color={color}>{icon} </Text>
        <Text color="#E0E0E0" bold>{label}</Text>
        {isRunning && elapsed > 0.5 && <Text color="#666"> ({elapsed.toFixed(1)}s)</Text>}
      </Box>
      {result && !diff && <Box><Text color="#666">  └ </Text><Text color="#808080">{result}</Text></Box>}
      {err && <Box><Text color="#666">  └ </Text><Text color="#E07070">{String(err).slice(0, 80)}</Text></Box>}
      {diff && (
        <Box flexDirection="column">
          <Box><Text color="#666">  └ </Text><Text color="#808080">{tool.result!.summary || 'Changes:'}</Text></Box>
          <DiffView diff={diff} file={tool.result!.file} collapsed={diff.length > 6} />
        </Box>
      )}
    </Box>
  );
});

function fmtTool(name: string, input: Record<string, unknown>): string {
  const n = name?.toLowerCase() || '';
  if (n === 'read') return `Read(${String(input?.file_path || '').split('/').pop()})`;
  if (n === 'edit') return `Edit(${String(input?.file_path || '').split('/').pop()})`;
  if (n === 'write') return `Write(${String(input?.file_path || '').split('/').pop()})`;
  if (n === 'bash') { const c = String(input?.command || ''); return `Bash(${c.slice(0, 40)}${c.length > 40 ? '...' : ''})`; }
  if (n === 'glob') return `Glob("${input?.pattern || ''}")`;
  if (n === 'grep') return `Grep("${String(input?.pattern || '').slice(0, 20)}")`;
  if (n === 'todowrite') return `TodoWrite(${(input?.todos as unknown[])?.length || 0})`;
  return name || 'Unknown';
}

function fmtResult(r: Record<string, unknown>): string {
  if (!r || typeof r !== 'object') return '✓';
  if (Array.isArray(r.files)) return `${r.files.length} files`;
  if (typeof r.content === 'string') return `${r.content.split('\n').length} lines`;
  if (typeof r.matchCount === 'number') return `${r.matchCount} matches`;
  if (typeof r.message === 'string') return r.message.slice(0, 60);
  return '✓';
}

const DiffView = memo(function DiffView({ diff, file, collapsed }: { diff: DiffLine[]; file?: string; collapsed?: boolean }) {
  const show = collapsed ? diff.slice(0, 4) : diff.slice(0, 20);
  const hidden = collapsed ? diff.length - 4 : Math.max(0, diff.length - 20);
  return (
    <Box flexDirection="column" marginLeft={4}>
      {file && <Text color="#7B9FBF" dimColor>{file.split('/').pop()}</Text>}
      {show.map((l, i) => {
        const ln = l.lineNum ? String(l.lineNum).padStart(3) + ' ' : '    ';
        if (l.type === 'remove') return <Box key={i}><Text color="#666">{ln}</Text><Text color="#E07070" bold>- </Text><Text color="#E07070">{l.content}</Text></Box>;
        if (l.type === 'add') return <Box key={i}><Text color="#666">    </Text><Text color="#7DC87D" bold>+ </Text><Text color="#7DC87D">{l.content}</Text></Box>;
        return <Box key={i}><Text color="#666">{ln}  </Text><Text color="#808080">{l.content}</Text></Box>;
      })}
      {hidden > 0 && <Text color="#666" dimColor>  ... {hidden} more</Text>}
    </Box>
  );
});
