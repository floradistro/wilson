import { useState, memo, useMemo } from 'react';
import { Box, Text, useInput } from 'ink';
import { highlight } from 'cli-highlight';
import chalk from 'chalk';

// Syntax highlighting theme (Material-inspired, matches JetBrains Darcula)
const theme = {
  keyword: chalk.hex('#CC7832'),      // Orange keywords
  built_in: chalk.hex('#8888C6'),     // Purple built-ins
  type: chalk.hex('#B5B6E3'),         // Light purple types
  literal: chalk.hex('#6897BB'),      // Blue literals
  number: chalk.hex('#6897BB'),       // Blue numbers
  string: chalk.hex('#6A8759'),       // Green strings
  comment: chalk.hex('#808080'),      // Gray comments
  function: chalk.hex('#FFC66D'),     // Yellow functions
  class: chalk.hex('#A9B7C6'),        // Light class names
  variable: chalk.hex('#A9B7C6'),     // Light variables
  operator: chalk.hex('#A9B7C6'),     // Light operators
  punctuation: chalk.hex('#A9B7C6'),  // Light punctuation
  attr: chalk.hex('#BABABA'),         // Attributes
  tag: chalk.hex('#E8BF6A'),          // Tags
  name: chalk.hex('#E8BF6A'),         // Names
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

interface MarkdownProps {
  children: string;
  streaming?: boolean;
  /** Skip text-based metric extraction (when we have real chart data) */
  skipMetrics?: boolean;
}
interface Block {
  type: 'text' | 'code' | 'table' | 'metrics';
  content: string;
  lang?: string;
  incomplete?: boolean;
  rows?: string[][];
  headers?: string[];
  metrics?: Array<{ label: string; value: string }>;
  metricsTitle?: string;
}

export const Markdown = memo(function Markdown({ children, streaming = false, skipMetrics = false }: MarkdownProps) {
  // Memoize parsing to avoid re-parsing on every render
  const blocks = useMemo(() => parse(children), [children]);

  return (
    <Box flexDirection="column">
      {blocks.map((b, i) => {
        if (b.type === 'code') {
          return (
            <CodeBlock
              key={`code-${i}`}
              code={b.content}
              lang={b.lang || ''}
              isFirst={i === 0}
              incomplete={b.incomplete}
              streaming={streaming && i === blocks.length - 1}
            />
          );
        }
        if (b.type === 'table' && b.headers && b.rows) {
          return (
            <TableBlock
              key={`table-${i}`}
              headers={b.headers}
              rows={b.rows}
              isFirst={i === 0}
            />
          );
        }
        if (b.type === 'metrics' && b.metrics) {
          return (
            <MetricsBlock
              key={`metrics-${i}`}
              title={b.metricsTitle}
              metrics={b.metrics}
              isFirst={i === 0}
            />
          );
        }
        return (
          <TextBlock
            key={`text-${i}`}
            content={b.content}
            isFirst={i === 0}
            streaming={streaming && i === blocks.length - 1}
            skipMetrics={skipMetrics}
          />
        );
      })}
    </Box>
  );
});

const TextBlock = memo(function TextBlock({ content, isFirst, streaming, skipMetrics }: { content: string; isFirst?: boolean; streaming?: boolean; skipMetrics?: boolean }) {
  // Memoize paragraph splitting
  const paragraphs = useMemo(() => content.split(/\n\n+/).filter(p => p.trim()), [content]);
  if (!paragraphs.length) return null;

  return (
    <Box flexDirection="column" marginTop={isFirst ? 0 : 1}>
      {paragraphs.map((para, pIdx) => {
        // Check if this paragraph is a metrics section (header + bullet list with key-values)
        // Skip if we have real chart data from tool_result
        const metricsData = skipMetrics ? null : extractMetrics(para);
        if (metricsData) {
          return (
            <MetricsBlock
              key={pIdx}
              title={metricsData.title}
              metrics={metricsData.metrics}
              isFirst={pIdx === 0}
            />
          );
        }

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

// Extract metrics from a paragraph if it matches the pattern:
// Various title formats followed by bullet points with "Label: Value" format
function extractMetrics(para: string): { title: string; metrics: Array<{ label: string; value: string }> } | null {
  const lines = para.split('\n').map(l => l.trim()).filter(l => l);
  if (lines.length < 2) return null; // Need at least 1 metric

  // Try multiple title detection patterns
  let title = '';
  let startIdx = 0;

  // Pattern 1: "Title:" on its own line
  const colonMatch = lines[0].match(/^([A-Za-z][A-Za-z\s]+):\s*$/);
  if (colonMatch) {
    title = colonMatch[1].trim();
    startIdx = 1;
  }
  // Pattern 2: Just a short title word like "Summary" or "Metrics"
  else if (/^(Summary|Metrics|Results|Overview|Statistics|Data|Report|Analysis)$/i.test(lines[0])) {
    title = lines[0];
    startIdx = 1;
  }
  // Pattern 3: No title, just metrics - use generic title
  else if (lines[0].match(/^[-*•]\s*[^:]+:\s*.+$/)) {
    title = 'Summary';
    startIdx = 0;
  }

  // Collect metrics from remaining lines
  const metrics: Array<{ label: string; value: string }> = [];
  for (let i = startIdx; i < lines.length; i++) {
    const line = lines[i];

    // Match bullet + label + colon + value (flexible bullet matching)
    const bulletMatch = line.match(/^[-*•→]\s*([^:]+?):\s*(.+)$/);
    if (bulletMatch) {
      const label = bulletMatch[1].trim();
      const value = bulletMatch[2].trim();
      // Only treat as metric if value is short and looks like data
      if (value.length < 60 && /[\d$%,.]/.test(value)) {
        metrics.push({ label, value });
      }
      continue;
    }

    // Also match non-bulleted "Label: Value" patterns
    const kvMatch = line.match(/^([A-Za-z][A-Za-z\s]{2,20}):\s*(\$?[\d,]+\.?\d*%?\s*(?:orders?|items?|units?)?)\s*$/i);
    if (kvMatch) {
      metrics.push({ label: kvMatch[1].trim(), value: kvMatch[2].trim() });
    }
  }

  // Return if we found at least 2 metrics
  if (metrics.length >= 2 && title) {
    return { title, metrics };
  }

  return null;
}

// Table block with nice formatting
const TableBlock = memo(function TableBlock({
  headers, rows, isFirst
}: {
  headers: string[];
  rows: string[][];
  isFirst?: boolean;
}) {
  // Calculate column widths
  const colWidths = headers.map((h, i) => {
    const headerWidth = h.length;
    const maxDataWidth = Math.max(0, ...rows.map((row) => String(row[i] || '').length));
    return Math.min(Math.max(headerWidth, maxDataWidth, 4), 25);
  });

  const totalWidth = colWidths.reduce((sum, w) => sum + w + 3, 1);
  const border = c.dim;

  return (
    <Box flexDirection="column" marginTop={isFirst ? 0 : 1} marginBottom={1}>
      {/* Top border */}
      <Box>
        <Text>{border('╭')}</Text>
        {colWidths.map((w, i) => (
          <Text key={i}>{border('─'.repeat(w + 2) + (i < colWidths.length - 1 ? '┬' : ''))}</Text>
        ))}
        <Text>{border('╮')}</Text>
      </Box>

      {/* Headers */}
      <Box>
        <Text>{border('│')}</Text>
        {headers.map((h, i) => (
          <Box key={i} width={colWidths[i] + 3}>
            <Text> {chalk.bold.hex('#89DDFF')(h.slice(0, colWidths[i]).padEnd(colWidths[i]))} </Text>
            {i < headers.length - 1 && <Text>{border('│')}</Text>}
          </Box>
        ))}
        <Text>{border('│')}</Text>
      </Box>

      {/* Header separator */}
      <Box>
        <Text>{border('├')}</Text>
        {colWidths.map((w, i) => (
          <Text key={i}>{border('─'.repeat(w + 2) + (i < colWidths.length - 1 ? '┼' : ''))}</Text>
        ))}
        <Text>{border('┤')}</Text>
      </Box>

      {/* Data rows */}
      {rows.slice(0, 15).map((row, rowIdx) => (
        <Box key={rowIdx}>
          <Text>{border('│')}</Text>
          {row.map((cell, i) => {
            const val = String(cell || '').slice(0, colWidths[i]);
            // Color numbers/currency
            const isNum = /^-?\$?[\d,]+\.?\d*%?$/.test(val.trim());
            const isNeg = val.trim().startsWith('-');
            const color = isNum ? (isNeg ? '#E07070' : '#7DC87D') : '#C0C0C0';
            return (
              <Box key={i} width={colWidths[i] + 3}>
                <Text> {chalk.hex(color)(val.padEnd(colWidths[i]))} </Text>
                {i < row.length - 1 && <Text>{border('│')}</Text>}
              </Box>
            );
          })}
          <Text>{border('│')}</Text>
        </Box>
      ))}

      {/* More rows indicator */}
      {rows.length > 15 && (
        <Box>
          <Text>{border('│')}</Text>
          <Text color="#546E7A"> ... {rows.length - 15} more rows</Text>
        </Box>
      )}

      {/* Bottom border */}
      <Box>
        <Text>{border('╰')}</Text>
        {colWidths.map((w, i) => (
          <Text key={i}>{border('─'.repeat(w + 2) + (i < colWidths.length - 1 ? '┴' : ''))}</Text>
        ))}
        <Text>{border('╯')}</Text>
      </Box>
    </Box>
  );
});

// Metrics card - renders key-value pairs in a nice box
const MetricsBlock = memo(function MetricsBlock({
  title, metrics, isFirst
}: {
  title?: string;
  metrics: Array<{ label: string; value: string }>;
  isFirst?: boolean;
}) {
  if (!metrics.length) return null;

  // Calculate column widths
  const labelWidth = Math.max(...metrics.map(m => m.label.length), 8);
  const valueWidth = Math.max(...metrics.map(m => m.value.length), 8);
  const totalWidth = labelWidth + valueWidth + 5;

  const border = c.dim;

  return (
    <Box flexDirection="column" marginTop={isFirst ? 0 : 1} marginBottom={1}>
      {/* Top border with optional title */}
      <Box>
        <Text>{border('╭')}</Text>
        <Text>{border('─'.repeat(totalWidth))}</Text>
        {title && <Text>{border('─')} {chalk.hex('#82AAFF').bold(title)} </Text>}
        <Text>{border('╮')}</Text>
      </Box>

      {/* Metrics rows */}
      {metrics.map((m, idx) => {
        const val = m.value;
        const isCurrency = /^\$/.test(val);
        const isNegative = /^-|decrease|down/i.test(val);
        const isPercent = /%$/.test(val);

        let valueColor = '#EEFFFF';
        if (isCurrency) valueColor = '#7DC87D';
        if (isPercent && isNegative) valueColor = '#E07070';
        if (isPercent && !isNegative) valueColor = '#7DC87D';

        return (
          <Box key={idx}>
            <Text>{border('│')} </Text>
            <Text color="#888">{m.label.padEnd(labelWidth)}</Text>
            <Text>{border(' │ ')}</Text>
            <Text color={valueColor} bold>{val.padStart(valueWidth)}</Text>
            <Text> {border('│')}</Text>
          </Box>
        );
      })}

      {/* Bottom border */}
      <Box>
        <Text>{border('╰')}</Text>
        <Text>{border('─'.repeat(totalWidth + (title ? title.length + 4 : 0)))}</Text>
        <Text>{border('╯')}</Text>
      </Box>
    </Box>
  );
});

const CodeBlock = memo(function CodeBlock({
  code, lang, isFirst, incomplete, streaming
}: {
  code: string;
  lang: string;
  isFirst?: boolean;
  incomplete?: boolean;
  streaming?: boolean;
}) {
  const [expanded, setExpanded] = useState(false);

  useInput((input, key) => {
    if (key.ctrl && input === 'o') setExpanded(e => !e);
  });

  // Memoize syntax highlighting - only recompute when code changes
  const { hlLines, lines } = useMemo(() => {
    const lines = code.split('\n');
    let hl: string;
    try {
      hl = highlight(code, { language: lang || 'plaintext', ignoreIllegals: true, theme });
    } catch {
      hl = code;
    }
    return { hlLines: hl.split('\n'), lines };
  }, [code, lang]);

  const isLong = lines.length > 10;
  const show = expanded || !isLong ? hlLines : hlLines.slice(0, 6);
  const hidden = isLong && !expanded ? lines.length - 6 : 0;

  // Border color - slightly brighter when streaming
  const borderColor = streaming ? '#555' : '#444';
  const langColor = streaming ? '#6A8759' : '#546E7A';

  return (
    <Box flexDirection="column" marginTop={isFirst ? 0 : 1} marginBottom={incomplete ? 0 : 1}>
      {/* Header */}
      <Box>
        <Text color={borderColor}>╭─</Text>
        {lang && <Text color={langColor}> {lang} </Text>}
        {isLong && !incomplete && <Text color="#444">{expanded ? '[-]' : `[+${lines.length}]`}</Text>}
        {incomplete && <Text color="#FFC66D"> ...</Text>}
      </Box>

      {/* Code lines - instant syntax highlighting */}
      {show.map((l, i) => (
        <Box key={i}>
          <Text color={borderColor}>│</Text>
          <Text color="#3A3A3A">{String(i + 1).padStart(3)} </Text>
          <Text>{l}</Text>
        </Box>
      ))}

      {/* Hidden indicator */}
      {hidden > 0 && !incomplete && (
        <Box>
          <Text color={borderColor}>│</Text>
          <Text color="#3A3A3A">    </Text>
          <Text color="#546E7A">... {hidden} more lines (Ctrl+O to expand)</Text>
        </Box>
      )}

      {/* Footer - don't show if code block is incomplete (still streaming) */}
      {!incomplete && (
        <Box>
          <Text color={borderColor}>╰─</Text>
        </Box>
      )}
    </Box>
  );
});

function parse(text: string): Block[] {
  if (!text) return [];
  const blocks: Block[] = [];

  // === AGGRESSIVE TEXT CLEANUP ===
  // Remove all stray ** markers (Claude keeps outputting these despite instructions)
  text = text.replace(/\*\*([^*]+)\*\*/g, '$1'); // **text** -> text (remove bold entirely)
  text = text.replace(/\*\*\s*/g, ''); // lone ** at start
  text = text.replace(/\s*\*\*/g, ''); // lone ** at end

  // Clean up ## headers that Claude sometimes uses
  text = text.replace(/^##\s+/gm, ''); // ## Header -> Header

  // Remove emojis Claude sometimes adds
  text = text.replace(/[\u{1F300}-\u{1F9FF}]|[\u{2600}-\u{26FF}]|[\u{2700}-\u{27BF}]/gu, '');

  // Fix sentences stuck together
  text = text.replace(/([.!?:])([A-Z])/g, '$1\n\n$2');
  text = text.replace(/([.!?:])(?=Now |Let me |Perfect|I'll |Here's |Based on )/g, '$1\n\n');

  // Clean up multiple newlines
  text = text.replace(/\n{3,}/g, '\n\n');

  // === AUTO-DETECT RAW CODE WITHOUT FENCES ===
  // If text contains lots of JSX/HTML tags without code fences, wrap it
  const hasRawCode = (
    // JSX/React patterns
    /<[A-Z][a-zA-Z]*[\s>]/.test(text) && // Component tags like <Box>, <Text>
    /<\/[A-Z][a-zA-Z]*>/.test(text) &&   // Closing tags
    !text.includes('```')                 // No existing code fences
  );

  if (hasRawCode) {
    // Find where the code starts (first JSX-looking line)
    const lines = text.split('\n');
    const codeStartIdx = lines.findIndex(l => /<[A-Z][a-zA-Z]*[\s>]/.test(l) || /^\s*(const|let|function|import|export)\s/.test(l));
    if (codeStartIdx >= 0) {
      const beforeCode = lines.slice(0, codeStartIdx).join('\n').trim();
      const codeBlock = lines.slice(codeStartIdx).join('\n');
      text = beforeCode + (beforeCode ? '\n\n' : '') + '```tsx\n' + codeBlock + '\n```';
    }
  }

  const lines = text.split('\n');
  let buf: string[] = [], inCode = false, lang = '', inTable = false;
  let tableHeaders: string[] = [], tableRows: string[][] = [];

  for (const line of lines) {
    // Code block handling
    if (line.startsWith('```')) {
      // Flush table if we were in one
      if (inTable && tableHeaders.length > 0) {
        blocks.push({ type: 'table', content: '', headers: tableHeaders, rows: tableRows });
        inTable = false;
        tableHeaders = [];
        tableRows = [];
      }

      if (!inCode) {
        // Starting a code block
        if (buf.length) {
          blocks.push({ type: 'text', content: buf.join('\n') });
          buf = [];
        }
        inCode = true;
        lang = line.slice(3).trim();
      } else {
        // Ending a code block
        blocks.push({ type: 'code', content: buf.join('\n'), lang, incomplete: false });
        inCode = false;
        lang = '';
        buf = [];
      }
      continue;
    }

    if (inCode) {
      buf.push(line);
      continue;
    }

    // Table detection - line starts with | and contains |
    const isTableLine = /^\|.*\|/.test(line.trim());
    const isSeparator = /^\|[\s\-:|]+\|$/.test(line.trim());

    if (isTableLine) {
      // Flush text buffer if we have one
      if (!inTable && buf.length) {
        blocks.push({ type: 'text', content: buf.join('\n') });
        buf = [];
      }

      // Parse cells from the line
      const cells = line.trim()
        .slice(1, -1)  // Remove leading/trailing |
        .split('|')
        .map(c => c.trim());

      if (!inTable) {
        // First table line - these are headers
        tableHeaders = cells;
        inTable = true;
      } else if (isSeparator) {
        // Skip separator line (|---|---|)
        continue;
      } else {
        // Data row
        tableRows.push(cells);
      }
      continue;
    }

    // Not a table line - flush table if we were in one
    if (inTable && tableHeaders.length > 0) {
      blocks.push({ type: 'table', content: '', headers: tableHeaders, rows: tableRows });
      inTable = false;
      tableHeaders = [];
      tableRows = [];
    }

    buf.push(line);
  }

  // Handle remaining buffer
  if (inTable && tableHeaders.length > 0) {
    blocks.push({ type: 'table', content: '', headers: tableHeaders, rows: tableRows });
  }

  if (buf.length) {
    blocks.push({
      type: inCode ? 'code' : 'text',
      content: buf.join('\n'),
      lang: inCode ? lang : undefined,
      incomplete: inCode,
    });
  }

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
    const content = ul[2];

    // Detect key-value metric patterns in list items (e.g., "Revenue: $397,636")
    const kvMatch = content.match(/^(\*\*)?([^:*]+)(\*\*)?:\s*(.+)$/);
    if (kvMatch) {
      const label = kvMatch[2].trim();
      const value = kvMatch[4].trim();
      return pad + c.bullet(bullet + ' ') + renderMetricLine(label, value);
    }

    return pad + c.bullet(bullet + ' ') + renderInline(content);
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

  // Action lines - Claude-style "Let me..." / "I'll..." (only at START of line, not mid-sentence)
  if (/^(Let me|I'll|I will|I'm going to|Let's)\s/i.test(trimmed) && trimmed.length < 100) {
    return c.action('→ ') + renderInline(trimmed);
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

// Render metric key-value pairs with appropriate colors
function renderMetricLine(label: string, value: string): string {
  const formattedLabel = c.muted(label + ':');

  // Detect value type and color appropriately
  const isCurrency = /^\$[\d,]+/.test(value);
  const isPercent = /%/.test(value);
  const isNegative = /decrease|dropped|down|-\d|declined/i.test(value);
  const isPositive = /increase|up|\+\d|grew|growth/i.test(value);

  let formattedValue: string;
  if (isCurrency) {
    // Currency - green
    formattedValue = chalk.hex('#7DC87D').bold(value);
  } else if (isPercent && isNegative) {
    // Negative percentage - red
    formattedValue = chalk.hex('#E07070')(value);
  } else if (isPercent && isPositive) {
    // Positive percentage - green
    formattedValue = chalk.hex('#7DC87D')(value);
  } else if (isNegative) {
    // Negative context - red
    formattedValue = chalk.hex('#E07070')(value);
  } else if (/^[\d,]+$/.test(value.replace(/,/g, ''))) {
    // Plain number - cyan
    formattedValue = chalk.hex('#89DDFF').bold(value);
  } else {
    formattedValue = c.text(value);
  }

  return formattedLabel + ' ' + formattedValue;
}

function renderInline(t: string): string {
  // Inline code - highlight
  t = t.replace(/`([^`]+)`/g, (_, x) => c.code(x));

  // Bold - already stripped in parse(), but just in case
  t = t.replace(/\*\*([^*]+)\*\*/g, (_, x) => c.bold(x));
  t = t.replace(/__([^_]+)__/g, (_, x) => c.bold(x));

  // Italic
  t = t.replace(/(?<!\*)\*([^*]+)\*(?!\*)/g, (_, x) => c.italic(x));
  t = t.replace(/(?<!_)_([^_]+)_(?!_)/g, (_, x) => c.italic(x));

  // Links - show text, dim the URL indicator
  t = t.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, txt) => c.link(txt));

  // Strikethrough
  t = t.replace(/~~([^~]+)~~/g, (_, x) => chalk.strikethrough.dim(x));

  // === PROMINENT NUMBER FORMATTING ===

  // Currency values - bright green and bold
  t = t.replace(/\$[\d,]+(?:\.\d{2})?/g, (match) => chalk.hex('#7DC87D').bold(match));

  // Large plain numbers (1000+) - cyan and bold
  t = t.replace(/\b(\d{1,3}(?:,\d{3})+)\b/g, (match) => chalk.hex('#89DDFF').bold(match));

  // Smaller numbers in context - cyan
  t = t.replace(/\b(\d+(?:\.\d+)?)\s*(orders?|items?|units?|products?|customers?|visitors?|sessions?)/gi,
    (_, num, unit) => chalk.hex('#89DDFF').bold(num) + ' ' + chalk.hex('#888888')(unit));

  // Percentage changes - color based on sign
  t = t.replace(/(\+\d+(?:\.\d+)?%)/g, (match) => chalk.hex('#7DC87D').bold(match));
  t = t.replace(/(-\d+(?:\.\d+)?%)/g, (match) => chalk.hex('#E07070').bold(match));
  // Neutral percentages
  t = t.replace(/(\d+(?:\.\d+)?%)/g, (match) => chalk.hex('#89DDFF')(match));

  // Time periods - subtle
  t = t.replace(/\b(today|yesterday|this week|last week|this month|last month|this year|last year)\b/gi,
    (match) => chalk.hex('#888888')(match));

  // File paths - subtle highlight
  t = t.replace(/`?([\/~][\w\-\.\/]+\.\w+)`?/g, (match, path) => {
    if (match.startsWith('`')) return match; // Already handled
    return c.code(path);
  });

  return c.text(t);
}

export { c as colors };
