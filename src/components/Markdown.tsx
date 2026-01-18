import { useState, memo } from 'react';
import { Box, Text, useInput } from 'ink';
import { highlight } from 'cli-highlight';
import chalk from 'chalk';

// Syntax highlighting theme (Material-inspired)
const theme = {
  keyword: chalk.hex('#C792EA'),
  built_in: chalk.hex('#82AAFF'),
  type: chalk.hex('#FFCB6B'),
  literal: chalk.hex('#F78C6C'),
  number: chalk.hex('#F78C6C'),
  string: chalk.hex('#C3E88D'),
  comment: chalk.hex('#546E7A'),
  function: chalk.hex('#82AAFF'),
  class: chalk.hex('#FFCB6B'),
  variable: chalk.hex('#EEFFFF'),
  operator: chalk.hex('#89DDFF'),
  punctuation: chalk.hex('#89DDFF'),
};

// Color palette
const c = {
  h1: chalk.bold.hex('#82AAFF'),
  h2: chalk.bold.hex('#89DDFF'),
  h3: chalk.bold.hex('#A0A0A0'),
  code: chalk.hex('#C792EA'),
  link: chalk.underline.hex('#82AAFF'),
  bold: chalk.bold.hex('#EEFFFF'),
  italic: chalk.italic.hex('#B0B0B0'),
  bullet: chalk.hex('#7DC87D'),
  number: chalk.hex('#F78C6C'),
  quote: chalk.italic.hex('#546E7A'),
  dim: chalk.hex('#546E7A'),
  text: chalk.hex('#C0C0C0'),
  muted: chalk.hex('#888888'),
  action: chalk.hex('#7DC87D'),
  label: chalk.hex('#89DDFF'),
};

interface MarkdownProps { children: string; }
interface Block { type: 'text' | 'code'; content: string; lang?: string; }

export const Markdown = memo(function Markdown({ children }: MarkdownProps) {
  const blocks = parse(children);
  return (
    <Box flexDirection="column">
      {blocks.map((b, i) => b.type === 'code'
        ? <CodeBlock key={i} code={b.content} lang={b.lang || ''} isFirst={i === 0} />
        : <TextBlock key={i} content={b.content} isFirst={i === 0} />
      )}
    </Box>
  );
});

const TextBlock = memo(function TextBlock({ content, isFirst }: { content: string; isFirst?: boolean }) {
  // Split into paragraphs
  const paragraphs = content.split(/\n\n+/).filter(p => p.trim());
  if (!paragraphs.length) return null;

  return (
    <Box flexDirection="column" marginTop={isFirst ? 0 : 1}>
      {paragraphs.map((para, pIdx) => {
        const lines = para.split('\n');
        const rendered = lines.map((line, lIdx) => renderLine(line, lIdx === 0)).filter(l => l !== null);
        if (!rendered.length) return null;

        return (
          <Box key={pIdx} flexDirection="column" marginTop={pIdx > 0 ? 1 : 0}>
            {rendered.map((line, lIdx) => (
              <Text key={lIdx}>{line}</Text>
            ))}
          </Box>
        );
      })}
    </Box>
  );
});

const CodeBlock = memo(function CodeBlock({ code, lang, isFirst }: { code: string; lang: string; isFirst?: boolean }) {
  const [expanded, setExpanded] = useState(false);
  const lines = code.split('\n');
  const isLong = lines.length > 10;

  useInput((input, key) => {
    if (key.ctrl && input === 'o') setExpanded(e => !e);
  });

  let hl: string;
  try { hl = highlight(code, { language: lang || 'plaintext', ignoreIllegals: true, theme }); }
  catch { hl = code; }

  const hlLines = hl.split('\n');
  const show = expanded || !isLong ? hlLines : hlLines.slice(0, 6);
  const hidden = isLong && !expanded ? lines.length - 6 : 0;

  return (
    <Box flexDirection="column" marginTop={isFirst ? 0 : 1} marginBottom={1}>
      {/* Header */}
      <Box>
        <Text color="#444">╭─</Text>
        {lang && <Text color="#546E7A"> {lang} </Text>}
        {isLong && <Text color="#444">{expanded ? '[-]' : `[+${lines.length}]`}</Text>}
      </Box>

      {/* Code lines */}
      {show.map((l, i) => (
        <Box key={i}>
          <Text color="#444">│</Text>
          <Text color="#3A3A3A">{String(i + 1).padStart(3)} </Text>
          <Text>{l}</Text>
        </Box>
      ))}

      {/* Hidden indicator */}
      {hidden > 0 && (
        <Box>
          <Text color="#444">│</Text>
          <Text color="#3A3A3A">    </Text>
          <Text color="#546E7A">... {hidden} more lines (Ctrl+O to expand)</Text>
        </Box>
      )}

      {/* Footer */}
      <Box>
        <Text color="#444">╰─</Text>
      </Box>
    </Box>
  );
});

function parse(text: string): Block[] {
  if (!text) return [];
  const blocks: Block[] = [];
  const lines = text.split('\n');
  let buf: string[] = [], inCode = false, lang = '';

  for (const line of lines) {
    if (line.startsWith('```')) {
      if (!inCode) {
        if (buf.length) { blocks.push({ type: 'text', content: buf.join('\n') }); buf = []; }
        inCode = true; lang = line.slice(3).trim();
      } else {
        blocks.push({ type: 'code', content: buf.join('\n'), lang });
        inCode = false; lang = ''; buf = [];
      }
    } else if (inCode) { buf.push(line); }
    else { buf.push(line); }
  }
  if (buf.length) blocks.push({ type: inCode ? 'code' : 'text', content: buf.join('\n'), lang: inCode ? lang : undefined });
  return blocks;
}

function renderLine(line: string, isFirstInPara: boolean): string | null {
  const trimmed = line.trim();
  if (!trimmed) return null;

  // Headers - prominent styling
  if (line.startsWith('### ')) return '\n' + c.h3('   ' + line.slice(4));
  if (line.startsWith('## ')) return '\n' + c.h2('  ' + line.slice(3));
  if (line.startsWith('# ')) return '\n' + c.h1(' ' + line.slice(2));

  // Blockquote - indented with bar
  if (line.startsWith('> ')) {
    return c.dim('   │ ') + c.quote(line.slice(2));
  }

  // Unordered lists - nice bullets with indentation
  const ul = line.match(/^(\s*)[-*+]\s(.*)$/);
  if (ul) {
    const indent = ul[1].length;
    const bullet = indent > 0 ? '◦' : '•';
    const pad = '   ' + '  '.repeat(Math.floor(indent / 2));
    return pad + c.bullet(bullet + ' ') + renderInline(ul[2]);
  }

  // Ordered lists - numbered with indentation
  const ol = line.match(/^(\s*)(\d+)\.\s(.*)$/);
  if (ol) {
    const indent = ol[1].length;
    const pad = '   ' + '  '.repeat(Math.floor(indent / 2));
    return pad + c.number(ol[2] + '.') + ' ' + renderInline(ol[3]);
  }

  // Horizontal rule
  if (/^[-*_]{3,}$/.test(trimmed)) {
    return c.dim('   ' + '─'.repeat(50));
  }

  // Action lines - Claude-style "Let me..." / "I'll..."
  if (/^(Let me|Now let me|Now I'll|I'll|I will|I'm going to|Let's|First,|Next,|Then,|Finally,)\s/i.test(trimmed)) {
    return c.action('→ ') + c.text(trimmed);
  }

  // Label lines (ending with colon) - make them stand out
  if (trimmed.endsWith(':') && trimmed.length < 60 && !trimmed.includes('  ')) {
    return '\n' + c.label(trimmed);
  }

  // Key-value pairs (common in summaries)
  const kv = trimmed.match(/^([A-Za-z][A-Za-z\s]+):\s*(.+)$/);
  if (kv && kv[1].length < 20) {
    return '   ' + c.muted(kv[1] + ':') + ' ' + renderInline(kv[2]);
  }

  // Regular text - with slight indent for readability
  return '   ' + renderInline(trimmed);
}

function renderInline(t: string): string {
  // Inline code - highlight
  t = t.replace(/`([^`]+)`/g, (_, x) => c.code(x));

  // Bold
  t = t.replace(/\*\*([^*]+)\*\*/g, (_, x) => c.bold(x));
  t = t.replace(/__([^_]+)__/g, (_, x) => c.bold(x));

  // Italic
  t = t.replace(/(?<!\*)\*([^*]+)\*(?!\*)/g, (_, x) => c.italic(x));
  t = t.replace(/(?<!_)_([^_]+)_(?!_)/g, (_, x) => c.italic(x));

  // Links - show text, dim the URL indicator
  t = t.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, txt) => c.link(txt));

  // Strikethrough
  t = t.replace(/~~([^~]+)~~/g, (_, x) => chalk.strikethrough.dim(x));

  // File paths - subtle highlight
  t = t.replace(/`?([\/~][\w\-\.\/]+\.\w+)`?/g, (match, path) => {
    if (match.startsWith('`')) return match; // Already handled
    return c.code(path);
  });

  return c.text(t);
}

export { c as colors };
