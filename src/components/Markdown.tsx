import { memo, useMemo } from 'react';
import { Box, Text, useStdout } from 'ink';
import { COLORS } from '../theme/colors.js';

// ============================================================================
// Markdown Renderer - Clean, minimal, no boxes
// ============================================================================

interface MarkdownProps {
  children: string;
  streaming?: boolean;
  skipMetrics?: boolean;
}

export const Markdown = memo(function Markdown({ children, streaming = false }: MarkdownProps) {
  const { stdout } = useStdout();
  const width = (stdout?.columns || 80) - 4;

  const blocks = useMemo(() => parse(children), [children]);

  return (
    <Box flexDirection="column">
      {blocks.map((block, i) => (
        <Block key={i} block={block} width={width} isLast={i === blocks.length - 1 && streaming} />
      ))}
    </Box>
  );
});

// ============================================================================
// Block Types
// ============================================================================

interface ParsedBlock {
  type: 'text' | 'code' | 'list' | 'heading';
  content: string;
  lang?: string;
  level?: number;
  items?: string[];
  ordered?: boolean;
}

const Block = memo(function Block({ block, width, isLast }: { block: ParsedBlock; width: number; isLast?: boolean }) {
  switch (block.type) {
    case 'heading':
      return <HeadingBlock content={block.content} level={block.level || 1} />;
    case 'code':
      return <CodeBlock code={block.content} lang={block.lang} width={width} incomplete={isLast} />;
    case 'list':
      return <ListBlock items={block.items || []} ordered={block.ordered} />;
    default:
      return <TextBlock content={block.content} width={width} />;
  }
});

// ============================================================================
// Heading Block
// ============================================================================

const HeadingBlock = memo(function HeadingBlock({ content, level }: { content: string; level: number }) {
  const color = level === 1 ? COLORS.primary : level === 2 ? COLORS.info : COLORS.text;
  return (
    <Box marginTop={1}>
      <Text color={color} bold>{content}</Text>
    </Box>
  );
});

// ============================================================================
// Text Block - Simple paragraph
// ============================================================================

const TextBlock = memo(function TextBlock({ content, width }: { content: string; width: number }) {
  const lines = useMemo(() => wrapText(content, width), [content, width]);

  return (
    <Box flexDirection="column" marginTop={1}>
      {lines.map((line, i) => (
        <Text key={i} color={COLORS.text}>{line}</Text>
      ))}
    </Box>
  );
});

// ============================================================================
// List Block - Bullets or numbers, no boxes
// ============================================================================

const ListBlock = memo(function ListBlock({ items, ordered }: { items: string[]; ordered?: boolean }) {
  return (
    <Box flexDirection="column" marginTop={1}>
      {items.map((item, i) => (
        <Text key={i}>
          <Text color={COLORS.textDim}>{ordered ? `${i + 1}.` : '•'} </Text>
          <Text color={COLORS.text}>{item}</Text>
        </Text>
      ))}
    </Box>
  );
});

// ============================================================================
// Code Block - Simple, no box borders
// ============================================================================

const CodeBlock = memo(function CodeBlock({
  code, lang, width, incomplete
}: {
  code: string;
  lang?: string;
  width: number;
  incomplete?: boolean;
}) {
  const lines = code.split('\n');
  const maxLines = 15;
  const show = lines.slice(0, maxLines);
  const hidden = lines.length - maxLines;
  const lineNumWidth = String(show.length).length;

  return (
    <Box flexDirection="column" marginTop={1}>
      {/* Language label */}
      {lang && (
        <Text color={COLORS.textDim}>─ {lang} {incomplete ? '...' : ''}</Text>
      )}

      {/* Code lines */}
      {show.map((line, i) => {
        const displayLine = line.length > width - lineNumWidth - 2
          ? line.slice(0, width - lineNumWidth - 3) + '…'
          : line;

        return (
          <Text key={i}>
            <Text color={COLORS.textDisabled}>{String(i + 1).padStart(lineNumWidth)} </Text>
            <Text color={COLORS.text}>{displayLine}</Text>
          </Text>
        );
      })}

      {/* Hidden lines indicator */}
      {hidden > 0 && (
        <Text color={COLORS.textVeryDim}>
          {' '.repeat(lineNumWidth)} … {hidden} more lines
        </Text>
      )}
    </Box>
  );
});

// ============================================================================
// Parser - Convert markdown to blocks
// ============================================================================

function parse(text: string): ParsedBlock[] {
  if (!text) return [];

  const blocks: ParsedBlock[] = [];

  // Clean up text
  text = text
    .replace(/\*\*([^*]+)\*\*/g, '$1')  // Remove **bold**
    .replace(/\*\*/g, '')                // Remove stray **
    .replace(/^##\s+/gm, '')             // Remove ## headers
    .replace(/\n{3,}/g, '\n\n');         // Collapse multiple newlines

  // Add line breaks between distinct thoughts/actions
  // "sentence. Let me" -> "sentence.\n\nLet me"
  text = text.replace(/([.!?:])\s*(Let me|I'll|I will|Now |Perfect|This |The |I can|I see|Here|Looking|Based on|First|Next|Finally)/g, '$1\n\n$2');

  const lines = text.split('\n');
  let buffer: string[] = [];
  let inCode = false;
  let codeLang = '';
  let listItems: string[] = [];
  let listOrdered = false;

  const flushBuffer = () => {
    if (buffer.length > 0) {
      const content = buffer.join('\n').trim();
      if (content) {
        blocks.push({ type: 'text', content });
      }
      buffer = [];
    }
  };

  const flushList = () => {
    if (listItems.length > 0) {
      blocks.push({ type: 'list', content: '', items: listItems, ordered: listOrdered });
      listItems = [];
    }
  };

  for (const line of lines) {
    // Code fence
    if (line.startsWith('```')) {
      if (!inCode) {
        flushBuffer();
        flushList();
        inCode = true;
        codeLang = line.slice(3).trim();
      } else {
        blocks.push({ type: 'code', content: buffer.join('\n'), lang: codeLang });
        buffer = [];
        inCode = false;
        codeLang = '';
      }
      continue;
    }

    if (inCode) {
      buffer.push(line);
      continue;
    }

    // Heading
    const headingMatch = line.match(/^(#{1,3})\s+(.+)$/);
    if (headingMatch) {
      flushBuffer();
      flushList();
      blocks.push({ type: 'heading', content: headingMatch[2], level: headingMatch[1].length });
      continue;
    }

    // Unordered list
    const ulMatch = line.match(/^\s*[-*+]\s+(.+)$/);
    if (ulMatch) {
      flushBuffer();
      if (listOrdered && listItems.length > 0) {
        flushList();
      }
      listOrdered = false;
      listItems.push(ulMatch[1]);
      continue;
    }

    // Ordered list
    const olMatch = line.match(/^\s*\d+\.\s+(.+)$/);
    if (olMatch) {
      flushBuffer();
      if (!listOrdered && listItems.length > 0) {
        flushList();
      }
      listOrdered = true;
      listItems.push(olMatch[1]);
      continue;
    }

    // Regular line
    flushList();
    buffer.push(line);
  }

  // Flush remaining
  if (inCode) {
    blocks.push({ type: 'code', content: buffer.join('\n'), lang: codeLang });
  } else {
    flushBuffer();
  }
  flushList();

  return blocks;
}

// ============================================================================
// Text Wrapping - preserves paragraph structure
// ============================================================================

function wrapText(text: string, width: number): string[] {
  const result: string[] = [];

  // Split on double newlines to get paragraphs
  const paragraphs = text.split(/\n\n+/).filter(p => p.trim());

  for (let pIdx = 0; pIdx < paragraphs.length; pIdx++) {
    const para = paragraphs[pIdx].trim();
    if (!para) continue;

    // Word wrap within paragraph
    const words = para.replace(/\n/g, ' ').split(/\s+/);
    let line = '';

    for (const word of words) {
      if (!word) continue;

      if (line.length + word.length + 1 <= width) {
        line += (line ? ' ' : '') + word;
      } else {
        if (line) result.push(line);
        line = word.length > width ? word.slice(0, width - 1) + '…' : word;
      }
    }

    if (line) result.push(line);

    // Add blank line between paragraphs (except after last)
    if (pIdx < paragraphs.length - 1) {
      result.push('');
    }
  }

  return result;
}
