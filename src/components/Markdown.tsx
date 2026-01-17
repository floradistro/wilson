import { useState, memo } from 'react';
import { Box, Text, useInput } from 'ink';
import { highlight } from 'cli-highlight';
import chalk from 'chalk';

const theme = {
  keyword: chalk.hex('#C792EA'), built_in: chalk.hex('#82AAFF'), type: chalk.hex('#FFCB6B'),
  literal: chalk.hex('#F78C6C'), number: chalk.hex('#F78C6C'), string: chalk.hex('#C3E88D'),
  comment: chalk.hex('#546E7A'), function: chalk.hex('#82AAFF'), class: chalk.hex('#FFCB6B'),
  variable: chalk.hex('#EEFFFF'), operator: chalk.hex('#89DDFF'), punctuation: chalk.hex('#89DDFF'),
};

const c = {
  h1: chalk.bold.hex('#82AAFF'), h2: chalk.bold.hex('#89DDFF'), h3: chalk.hex('#A0A0A0'),
  code: chalk.hex('#C792EA'), link: chalk.underline.hex('#82AAFF'), bold: chalk.bold.hex('#EEFFFF'),
  italic: chalk.italic.hex('#B0B0B0'), bullet: chalk.hex('#7DC87D'), quote: chalk.italic.hex('#546E7A'),
  dim: chalk.hex('#546E7A'), text: chalk.hex('#B0B0B0'), action: chalk.hex('#7DC87D'),
};

interface MarkdownProps { children: string; }
interface Block { type: 'text' | 'code'; content: string; lang?: string; }

export const Markdown = memo(function Markdown({ children }: MarkdownProps) {
  const blocks = parse(children);
  return (
    <Box flexDirection="column">
      {blocks.map((b, i) => b.type === 'code'
        ? <CodeBlock key={i} code={b.content} lang={b.lang || ''} />
        : <TextBlock key={i} content={b.content} />
      )}
    </Box>
  );
});

const TextBlock = memo(function TextBlock({ content }: { content: string }) {
  // Split into paragraphs and render each
  const paragraphs = content.split(/\n\n+/).filter(p => p.trim());
  if (!paragraphs.length) return null;

  return (
    <Box flexDirection="column">
      {paragraphs.map((para, i) => {
        const lines = para.split('\n').map(renderLine).filter(l => l !== null);
        if (!lines.length) return null;
        return <Text key={i}>{lines.join('\n')}</Text>;
      })}
    </Box>
  );
});

const CodeBlock = memo(function CodeBlock({ code, lang }: { code: string; lang: string }) {
  const [expanded, setExpanded] = useState(false);
  const lines = code.split('\n');
  const isLong = lines.length > 8;

  useInput((input, key) => {
    if (key.ctrl && input === 'o') setExpanded(e => !e);
  });

  let hl: string;
  try { hl = highlight(code, { language: lang || 'plaintext', ignoreIllegals: true, theme }); }
  catch { hl = code; }

  const hlLines = hl.split('\n');
  const show = expanded || !isLong ? hlLines : hlLines.slice(0, 5);
  const hidden = isLong && !expanded ? lines.length - 5 : 0;

  return (
    <Box flexDirection="column">
      <Box>
        <Text color="#546E7A">┌─</Text>
        {lang && <Text color="#546E7A"> {lang} </Text>}
        {isLong && <Text color="#546E7A">{expanded ? '(^o -)' : `(^o + ${lines.length})`}</Text>}
      </Box>
      {show.map((l, i) => (
        <Box key={i}>
          <Text color="#546E7A">│</Text>
          <Text color="#444">{String(i + 1).padStart(3)} </Text>
          <Text>{l}</Text>
        </Box>
      ))}
      {hidden > 0 && <Box><Text color="#546E7A">│</Text><Text color="#444">    ... {hidden} more</Text></Box>}
      <Box><Text color="#546E7A">└─</Text></Box>
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

function renderLine(line: string): string | null {
  if (!line.trim()) return null;

  // Headers
  if (line.startsWith('### ')) return c.h3(line.slice(4));
  if (line.startsWith('## ')) return c.h2(line.slice(3));
  if (line.startsWith('# ')) return c.h1(line.slice(2));

  // Blockquote
  if (line.startsWith('> ')) return c.quote('  │ ' + line.slice(2));

  // Lists - with better bullets
  const ul = line.match(/^([\s]*)[-*+]\s(.*)$/);
  if (ul) return ul[1] + c.bullet('  → ') + renderInline(ul[2]);
  const ol = line.match(/^([\s]*)(\d+)\.\s(.*)$/);
  if (ol) return ol[1] + c.bullet('  ' + ol[2] + '. ') + renderInline(ol[3]);

  // HR
  if (/^[-*_]{3,}$/.test(line.trim())) return c.dim('─'.repeat(40));

  // Action lines (Let me, Now I'll, I'll, etc.) - style as actions
  if (/^(Let me|Now let me|Now I'll|I'll|I will|I'm going to|Let's)\s/i.test(line)) {
    return c.action('→ ') + c.text(line);
  }

  // Colon-ending lines are often headers/labels
  if (line.endsWith(':') && line.length < 80) {
    return c.bold(line);
  }

  return renderInline(line);
}

function renderInline(t: string): string {
  // Inline code
  t = t.replace(/`([^`]+)`/g, (_, x) => c.code(x));
  // Bold
  t = t.replace(/\*\*([^*]+)\*\*/g, (_, x) => c.bold(x));
  t = t.replace(/__([^_]+)__/g, (_, x) => c.bold(x));
  // Italic
  t = t.replace(/\*([^*]+)\*/g, (_, x) => c.italic(x));
  t = t.replace(/_([^_]+)_/g, (_, x) => c.italic(x));
  // Links
  t = t.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, txt) => c.link(txt));
  // Strikethrough
  t = t.replace(/~~([^~]+)~~/g, (_, x) => chalk.strikethrough.dim(x));
  // File paths
  t = t.replace(/([\/\w-]+\.\w+)/g, (match) => {
    if (match.includes('/') || /\.(html|css|js|ts|json|md|tsx|jsx)$/.test(match)) {
      return c.code(match);
    }
    return match;
  });
  return c.text(t);
}

export { c as colors };
