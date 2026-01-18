import { useState, useEffect, useRef, memo } from 'react';
import { Box, Text } from 'ink';
import type { Message, ToolCall } from '../types.js';
import { Markdown } from './Markdown.js';

const SPINNER = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
const CURSOR = '▋';

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
      {messages.map((m, i) => (
        <MessageItem key={m.id} message={m} isLast={i === messages.length - 1} />
      ))}
    </Box>
  );
});

const MessageItem = memo(function MessageItem({ message, isLast }: { message: Message; isLast?: boolean }) {
  const isUser = message.role === 'user';
  const hasTools = !isUser && message.toolCalls && message.toolCalls.length > 0;
  const hasContent = !isUser && message.content && message.content.trim();

  return (
    <Box flexDirection="column" marginBottom={isLast ? 0 : 2}>
      {/* User message - prominent green prompt */}
      {isUser && (
        <Box marginBottom={1}>
          <Text color="#7DC87D" bold>❯ </Text>
          <Text color="#E8E8E8">{String(message.content || '')}</Text>
        </Box>
      )}

      {/* Tool calls - grouped with visual hierarchy */}
      {hasTools && (
        <Box flexDirection="column" marginLeft={2}>
          {message.toolCalls!.map((t, i) => (
            <ToolItem key={`${t.id}-${i}`} tool={t} isFirst={i === 0} />
          ))}
        </Box>
      )}

      {/* Assistant text - clean spacing from tools */}
      {hasContent && (
        <Box marginTop={hasTools ? 1 : 0} marginLeft={2}>
          <StreamingText text={String(message.content)} isStreaming={message.isStreaming || false} />
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
    const id = setInterval(() => setFrame(f => (f + 1) % SPINNER.length), 80);
    return () => clearInterval(id);
  }, [isRunning]);

  const elapsed = isRunning ? ((Date.now() - startRef.current) / 1000) : 0;

  // Status indicators
  const icon = isRunning ? SPINNER[frame] : tool.status === 'completed' ? '✓' : tool.status === 'error' ? '✗' : '○';
  const iconColor = isRunning ? '#FFCB6B' : tool.status === 'completed' ? '#7DC87D' : tool.status === 'error' ? '#E07070' : '#555';

  const label = fmtTool(tool.name, tool.input);
  const result = tool.status === 'completed' && tool.result ? fmtResult(tool.result) : null;
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

      {/* Simple result */}
      {result && !diff && (
        <Box marginLeft={2}>
          <Text color="#546E7A">└─ </Text>
          <Text color="#888">{result}</Text>
        </Box>
      )}

      {/* Error */}
      {err && (
        <Box marginLeft={2}>
          <Text color="#546E7A">└─ </Text>
          <Text color="#E07070">{String(err).slice(0, 100)}</Text>
        </Box>
      )}

      {/* Diff view */}
      {diff && (
        <Box flexDirection="column" marginLeft={2} marginTop={1}>
          <Box>
            <Text color="#546E7A">└─ </Text>
            <Text color="#888">{tool.result!.summary || 'Changes applied'}</Text>
          </Box>
          <DiffView diff={diff} file={tool.result!.file} collapsed={diff.length > 8} />
        </Box>
      )}
    </Box>
  );
});

function fmtTool(name: string, input: Record<string, unknown>): string {
  const n = name?.toLowerCase() || '';

  if (n === 'read') {
    const file = String(input?.file_path || '').split('/').pop();
    return `Read ${file}`;
  }
  if (n === 'edit') {
    const file = String(input?.file_path || '').split('/').pop();
    return `Edit ${file}`;
  }
  if (n === 'write') {
    const file = String(input?.file_path || '').split('/').pop();
    return `Write ${file}`;
  }
  if (n === 'bash') {
    const cmd = String(input?.command || '');
    const short = cmd.length > 50 ? cmd.slice(0, 47) + '...' : cmd;
    return `$ ${short}`;
  }
  if (n === 'glob') return `Glob "${input?.pattern || ''}"`;
  if (n === 'grep') return `Grep "${String(input?.pattern || '').slice(0, 25)}"`;
  if (n === 'todowrite') return `Update tasks (${(input?.todos as unknown[])?.length || 0})`;

  return name || 'Unknown';
}

function fmtResult(r: Record<string, unknown>): string {
  if (!r || typeof r !== 'object') return 'done';
  if (Array.isArray(r.files)) return `${r.files.length} files`;
  if (typeof r.content === 'string') {
    const lines = r.content.split('\n').length;
    return `${lines} line${lines !== 1 ? 's' : ''}`;
  }
  if (typeof r.matchCount === 'number') return `${r.matchCount} matches`;
  if (typeof r.message === 'string') return r.message.slice(0, 80);
  return 'done';
}

const DiffView = memo(function DiffView({ diff, file, collapsed }: { diff: DiffLine[]; file?: string; collapsed?: boolean }) {
  const show = collapsed ? diff.slice(0, 5) : diff.slice(0, 25);
  const hidden = collapsed ? diff.length - 5 : Math.max(0, diff.length - 25);

  return (
    <Box flexDirection="column" marginLeft={3} marginTop={1}>
      {/* File name */}
      {file && (
        <Box marginBottom={1}>
          <Text color="#546E7A">╭─ </Text>
          <Text color="#82AAFF">{file.split('/').pop()}</Text>
        </Box>
      )}

      {/* Diff lines */}
      {show.map((l, i) => {
        const ln = l.lineNum ? String(l.lineNum).padStart(3) : '   ';

        if (l.type === 'remove') {
          return (
            <Box key={i}>
              <Text color="#546E7A">│</Text>
              <Text color="#444">{ln} </Text>
              <Text color="#E07070">- {l.content}</Text>
            </Box>
          );
        }
        if (l.type === 'add') {
          return (
            <Box key={i}>
              <Text color="#546E7A">│</Text>
              <Text color="#444">    </Text>
              <Text color="#7DC87D">+ {l.content}</Text>
            </Box>
          );
        }
        return (
          <Box key={i}>
            <Text color="#546E7A">│</Text>
            <Text color="#444">{ln}   </Text>
            <Text color="#666">{l.content}</Text>
          </Box>
        );
      })}

      {/* Hidden count */}
      {hidden > 0 && (
        <Box>
          <Text color="#546E7A">│</Text>
          <Text color="#444">      </Text>
          <Text color="#546E7A">... {hidden} more</Text>
        </Box>
      )}

      {/* Footer */}
      <Box>
        <Text color="#546E7A">╰─</Text>
      </Box>
    </Box>
  );
});

// Streaming text with cursor
const StreamingText = memo(function StreamingText({ text, isStreaming }: { text: string; isStreaming: boolean }) {
  const [showCursor, setShowCursor] = useState(true);

  useEffect(() => {
    if (!isStreaming) return;
    const timer = setInterval(() => setShowCursor(v => !v), 530);
    return () => clearInterval(timer);
  }, [isStreaming]);

  if (!isStreaming) {
    return <Markdown>{text}</Markdown>;
  }

  return (
    <Box>
      <Markdown>{text}</Markdown>
      {showCursor && <Text color="#7DC87D">{CURSOR}</Text>}
    </Box>
  );
});
