import { memo, useMemo } from 'react';
import { Box, Text, useStdout } from 'ink';
import { COLORS } from '../theme/colors.js';

interface MarkdownProps {
  children: string;
  streaming?: boolean;
  skipMetrics?: boolean;
}

export const Markdown = memo(function Markdown({ children, streaming = false }: MarkdownProps) {
  const { stdout } = useStdout();
  const width = (stdout?.columns || 80) - 2;

  const blocks = useMemo(() => parseMarkdown(children || ''), [children]);

  if (!blocks.length) return null;

  return (
    <Box flexDirection="column" gap={0}>
      {blocks.map((block, i) => (
        <RenderBlock key={i} block={block} width={width} streaming={streaming && i === blocks.length - 1} />
      ))}
    </Box>
  );
});

// Block types
type Block =
  | { type: 'paragraph'; content: string }
  | { type: 'code'; content: string; lang?: string }
  | { type: 'list'; items: string[]; ordered: boolean }
  | { type: 'heading'; content: string; level: number };

function RenderBlock({ block, width, streaming }: { block: Block; width: number; streaming?: boolean }) {
  switch (block.type) {
    case 'heading':
      return (
        <Text color={block.level === 1 ? COLORS.primary : COLORS.text} bold>
          {block.content}
        </Text>
      );

    case 'code':
      return <CodeBlock code={block.content} lang={block.lang} width={width} streaming={streaming} />;

    case 'list':
      return (
        <Box flexDirection="column" gap={0}>
          {block.items.map((item, i) => (
            <Text key={i} color={COLORS.text}>
              <Text color={COLORS.textDim}>{block.ordered ? `${i + 1}. ` : ' - '}</Text>
              {item}
            </Text>
          ))}
        </Box>
      );

    case 'paragraph':
    default:
      const lines = wrapText(block.content, width);
      return (
        <Box flexDirection="column" gap={0}>
          {lines.map((line, i) => (
            <Text key={i} color={COLORS.text}>{line}</Text>
          ))}
        </Box>
      );
  }
}

// Code block with syntax highlighting hints
const CodeBlock = memo(function CodeBlock({
  code, lang, width, streaming
}: {
  code: string;
  lang?: string;
  width: number;
  streaming?: boolean;
}) {
  const lines = code.split('\n');
  const maxLines = 20;
  const show = lines.slice(0, maxLines);
  const hidden = lines.length - maxLines;
  const lnWidth = String(Math.min(lines.length, maxLines)).length;
  const codeWidth = width - lnWidth - 4;

  return (
    <Box flexDirection="column" gap={0}>
      {/* Language header */}
      {lang && (
        <Text color={COLORS.textDim}>
          {'  '}-- {lang} {streaming ? '...' : ''}
        </Text>
      )}

      {/* Code lines with line numbers */}
      {show.map((line, i) => {
        const displayLine = line.length > codeWidth
          ? line.slice(0, codeWidth - 3) + '...'
          : line;

        return (
          <Text key={i}>
            <Text color={COLORS.textVeryDim}>{String(i + 1).padStart(lnWidth)}  </Text>
            <Text color={COLORS.text}>{highlightLine(displayLine, lang)}</Text>
          </Text>
        );
      })}

      {/* Truncation notice */}
      {hidden > 0 && (
        <Text color={COLORS.textVeryDim}>
          {' '.repeat(lnWidth)}  ... {hidden} more lines
        </Text>
      )}
    </Box>
  );
});

// Simple syntax highlighting
function highlightLine(line: string, lang?: string): JSX.Element {
  if (!lang) return <>{line}</>;

  // Keywords for common languages
  const keywords = ['const', 'let', 'var', 'function', 'return', 'if', 'else', 'for', 'while',
    'import', 'export', 'from', 'class', 'extends', 'new', 'this', 'async', 'await',
    'try', 'catch', 'throw', 'default', 'switch', 'case', 'break', 'continue',
    'true', 'false', 'null', 'undefined', 'typeof', 'instanceof'];

  // Simple token-based highlighting
  const parts: JSX.Element[] = [];
  let remaining = line;
  let key = 0;

  while (remaining.length > 0) {
    // String (single or double quotes)
    const strMatch = remaining.match(/^(['"`]).*?\1/);
    if (strMatch) {
      parts.push(<Text key={key++} color={COLORS.syntax.string}>{strMatch[0]}</Text>);
      remaining = remaining.slice(strMatch[0].length);
      continue;
    }

    // Comment
    if (remaining.startsWith('//')) {
      parts.push(<Text key={key++} color={COLORS.syntax.comment}>{remaining}</Text>);
      break;
    }

    // Number
    const numMatch = remaining.match(/^\d+(\.\d+)?/);
    if (numMatch) {
      parts.push(<Text key={key++} color={COLORS.syntax.number}>{numMatch[0]}</Text>);
      remaining = remaining.slice(numMatch[0].length);
      continue;
    }

    // Keyword or identifier
    const wordMatch = remaining.match(/^[a-zA-Z_$][a-zA-Z0-9_$]*/);
    if (wordMatch) {
      const word = wordMatch[0];
      if (keywords.includes(word)) {
        parts.push(<Text key={key++} color={COLORS.syntax.keyword}>{word}</Text>);
      } else if (word[0] === word[0].toUpperCase() && word[0] !== word[0].toLowerCase()) {
        // Capitalized = likely type/class
        parts.push(<Text key={key++} color={COLORS.syntax.type}>{word}</Text>);
      } else {
        parts.push(<Text key={key++} color={COLORS.text}>{word}</Text>);
      }
      remaining = remaining.slice(word.length);
      continue;
    }

    // Operators and punctuation
    const opMatch = remaining.match(/^[=+\-*/<>!&|?:;,.()[\]{}]+/);
    if (opMatch) {
      parts.push(<Text key={key++} color={COLORS.syntax.operator}>{opMatch[0]}</Text>);
      remaining = remaining.slice(opMatch[0].length);
      continue;
    }

    // Single character (whitespace or unknown)
    parts.push(<Text key={key++}>{remaining[0]}</Text>);
    remaining = remaining.slice(1);
  }

  return <>{parts}</>;
}

// Parse markdown into blocks
function parseMarkdown(text: string): Block[] {
  if (!text.trim()) return [];

  const blocks: Block[] = [];
  const lines = text.split('\n');
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    // Code block
    if (line.startsWith('```')) {
      const lang = line.slice(3).trim() || undefined;
      const codeLines: string[] = [];
      i++;
      while (i < lines.length && !lines[i].startsWith('```')) {
        codeLines.push(lines[i]);
        i++;
      }
      blocks.push({ type: 'code', content: codeLines.join('\n'), lang });
      i++; // skip closing ```
      continue;
    }

    // Heading
    const headingMatch = line.match(/^(#{1,3})\s+(.+)$/);
    if (headingMatch) {
      blocks.push({ type: 'heading', content: headingMatch[2], level: headingMatch[1].length });
      i++;
      continue;
    }

    // List item
    const ulMatch = line.match(/^\s*[-*+]\s+(.+)$/);
    const olMatch = line.match(/^\s*(\d+)\.\s+(.+)$/);
    if (ulMatch || olMatch) {
      const items: string[] = [];
      const ordered = !!olMatch;
      while (i < lines.length) {
        const itemMatch = ordered
          ? lines[i].match(/^\s*\d+\.\s+(.+)$/)
          : lines[i].match(/^\s*[-*+]\s+(.+)$/);
        if (!itemMatch) break;
        items.push(itemMatch[1] || itemMatch[2]);
        i++;
      }
      blocks.push({ type: 'list', items, ordered });
      continue;
    }

    // Paragraph - collect until empty line or special line
    const paraLines: string[] = [];
    while (i < lines.length) {
      const l = lines[i];
      if (!l.trim() || l.startsWith('```') || l.match(/^#{1,3}\s/) || l.match(/^\s*[-*+]\s/) || l.match(/^\s*\d+\.\s/)) {
        break;
      }
      paraLines.push(l);
      i++;
    }

    if (paraLines.length > 0) {
      // Clean up bold/italic markers
      let content = paraLines.join(' ')
        .replace(/\*\*([^*]+)\*\*/g, '$1')
        .replace(/\*([^*]+)\*/g, '$1')
        .replace(/__([^_]+)__/g, '$1')
        .replace(/_([^_]+)_/g, '$1')
        .replace(/`([^`]+)`/g, '$1')
        .trim();

      if (content) {
        blocks.push({ type: 'paragraph', content });
      }
    }

    // Skip empty lines
    while (i < lines.length && !lines[i].trim()) {
      i++;
    }
  }

  return blocks;
}

// Word wrap
function wrapText(text: string, width: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = '';

  for (const word of words) {
    if (line.length + word.length + 1 <= width) {
      line += (line ? ' ' : '') + word;
    } else {
      if (line) lines.push(line);
      line = word.length > width ? word.slice(0, width - 3) + '...' : word;
    }
  }

  if (line) lines.push(line);
  return lines;
}
