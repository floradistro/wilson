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
            <Text key={i}>
              <Text color={COLORS.textDim}>{block.ordered ? `${i + 1}. ` : ' - '}</Text>
              {highlightFinancials(item)}
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
            <Text key={i}>{highlightFinancials(line)}</Text>
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

// =============================================================================
// Advanced Syntax Highlighting
// =============================================================================

// Language-specific keyword sets
const LANG_KEYWORDS: Record<string, Set<string>> = {
  javascript: new Set([
    'const', 'let', 'var', 'function', 'return', 'if', 'else', 'for', 'while', 'do',
    'import', 'export', 'from', 'as', 'default', 'class', 'extends', 'new', 'this',
    'async', 'await', 'try', 'catch', 'finally', 'throw', 'switch', 'case', 'break',
    'continue', 'typeof', 'instanceof', 'in', 'of', 'yield', 'static', 'get', 'set',
    'super', 'with', 'debugger', 'delete', 'void',
  ]),
  typescript: new Set([
    'const', 'let', 'var', 'function', 'return', 'if', 'else', 'for', 'while', 'do',
    'import', 'export', 'from', 'as', 'default', 'class', 'extends', 'new', 'this',
    'async', 'await', 'try', 'catch', 'finally', 'throw', 'switch', 'case', 'break',
    'continue', 'typeof', 'instanceof', 'in', 'of', 'yield', 'static', 'get', 'set',
    'super', 'with', 'debugger', 'delete', 'void',
    'type', 'interface', 'enum', 'namespace', 'module', 'declare', 'implements',
    'public', 'private', 'protected', 'readonly', 'abstract', 'override', 'keyof',
    'infer', 'satisfies', 'is', 'asserts',
  ]),
  python: new Set([
    'def', 'class', 'return', 'if', 'elif', 'else', 'for', 'while', 'try', 'except',
    'finally', 'with', 'as', 'import', 'from', 'raise', 'pass', 'break', 'continue',
    'lambda', 'yield', 'global', 'nonlocal', 'assert', 'del', 'in', 'not', 'and', 'or',
    'is', 'async', 'await', 'match', 'case',
  ]),
  rust: new Set([
    'fn', 'let', 'mut', 'const', 'static', 'if', 'else', 'match', 'for', 'while', 'loop',
    'return', 'break', 'continue', 'struct', 'enum', 'impl', 'trait', 'type', 'where',
    'pub', 'mod', 'use', 'as', 'self', 'super', 'crate', 'unsafe', 'async', 'await',
    'move', 'ref', 'dyn', 'box',
  ]),
  go: new Set([
    'func', 'var', 'const', 'type', 'struct', 'interface', 'map', 'chan', 'if', 'else',
    'for', 'range', 'switch', 'case', 'default', 'select', 'return', 'break', 'continue',
    'goto', 'fallthrough', 'defer', 'go', 'package', 'import',
  ]),
  sql: new Set([
    'select', 'from', 'where', 'and', 'or', 'not', 'in', 'like', 'between', 'is', 'null',
    'order', 'by', 'asc', 'desc', 'limit', 'offset', 'group', 'having', 'join', 'left',
    'right', 'inner', 'outer', 'on', 'as', 'union', 'insert', 'into', 'values', 'update',
    'set', 'delete', 'create', 'table', 'index', 'drop', 'alter', 'add', 'column',
    'primary', 'key', 'foreign', 'references', 'constraint', 'unique', 'default', 'check',
    'case', 'when', 'then', 'else', 'end', 'cast', 'coalesce', 'distinct', 'exists',
    'count', 'sum', 'avg', 'min', 'max',
  ]),
  bash: new Set([
    'if', 'then', 'else', 'elif', 'fi', 'case', 'esac', 'for', 'while', 'until', 'do',
    'done', 'in', 'function', 'return', 'local', 'export', 'source', 'alias', 'unset',
    'readonly', 'declare', 'typeset', 'shift', 'exit', 'break', 'continue', 'trap',
    'echo', 'printf', 'read', 'cd', 'pwd', 'ls', 'cat', 'grep', 'sed', 'awk', 'find',
    'xargs', 'sort', 'uniq', 'head', 'tail', 'wc', 'cut', 'tr', 'tee', 'mkdir', 'rm',
    'cp', 'mv', 'chmod', 'chown', 'curl', 'wget', 'tar', 'gzip', 'git', 'npm', 'node',
  ]),
  css: new Set([
    'important', 'inherit', 'initial', 'unset', 'revert', 'none', 'auto', 'normal',
  ]),
  json: new Set([]), // JSON has no keywords, just structure
  html: new Set([]),
  xml: new Set([]),
  yaml: new Set(['true', 'false', 'null', 'yes', 'no', 'on', 'off']),
  markdown: new Set([]),
};

// Literals (true, false, null, etc.)
const LITERALS = new Set([
  'true', 'false', 'null', 'undefined', 'nil', 'None', 'True', 'False',
  'NaN', 'Infinity',
]);

// Built-in objects/functions
const BUILTINS = new Set([
  'console', 'window', 'document', 'process', 'require', 'module', 'exports',
  'Buffer', 'global', '__dirname', '__filename', 'setTimeout', 'setInterval',
  'clearTimeout', 'clearInterval', 'Promise', 'Array', 'Object', 'String',
  'Number', 'Boolean', 'Symbol', 'Map', 'Set', 'WeakMap', 'WeakSet', 'Date',
  'RegExp', 'Error', 'Math', 'JSON', 'Reflect', 'Proxy', 'Intl', 'fetch',
  'Request', 'Response', 'URL', 'URLSearchParams', 'FormData', 'Headers',
  'print', 'len', 'range', 'list', 'dict', 'str', 'int', 'float', 'bool',
  'open', 'input', 'type', 'isinstance', 'hasattr', 'getattr', 'setattr',
  'super', 'property', 'classmethod', 'staticmethod', 'enumerate', 'zip',
  'map', 'filter', 'reduce', 'sorted', 'reversed', 'any', 'all', 'sum',
  'min', 'max', 'abs', 'round', 'format',
]);

// TypeScript/Flow type keywords
const TYPE_KEYWORDS = new Set([
  'string', 'number', 'boolean', 'any', 'void', 'never', 'unknown', 'object',
  'symbol', 'bigint', 'undefined', 'null', 'Array', 'Promise', 'Record',
  'Partial', 'Required', 'Readonly', 'Pick', 'Omit', 'Exclude', 'Extract',
  'NonNullable', 'ReturnType', 'Parameters', 'InstanceType', 'Awaited',
]);

// Normalize language name
function normalizeLanguage(lang?: string): string {
  if (!lang) return 'text';
  const l = lang.toLowerCase().trim();
  const aliases: Record<string, string> = {
    'js': 'javascript', 'jsx': 'javascript', 'mjs': 'javascript', 'cjs': 'javascript',
    'ts': 'typescript', 'tsx': 'typescript', 'mts': 'typescript', 'cts': 'typescript',
    'py': 'python', 'python3': 'python',
    'rs': 'rust',
    'golang': 'go',
    'sh': 'bash', 'shell': 'bash', 'zsh': 'bash', 'fish': 'bash',
    'scss': 'css', 'sass': 'css', 'less': 'css',
    'yml': 'yaml',
    'md': 'markdown',
    'htm': 'html',
    'psql': 'sql', 'mysql': 'sql', 'pgsql': 'sql', 'sqlite': 'sql',
  };
  return aliases[l] || l;
}

// Token types for precise highlighting
type TokenType =
  | 'keyword' | 'builtin' | 'type' | 'literal' | 'number' | 'string'
  | 'comment' | 'function' | 'operator' | 'property' | 'variable'
  | 'punctuation' | 'tag' | 'attribute' | 'regexp' | 'decorator'
  | 'interpolation' | 'text';

interface Token {
  type: TokenType;
  value: string;
}

// Tokenize a line of code
function tokenizeLine(line: string, lang: string): Token[] {
  const tokens: Token[] = [];
  let pos = 0;
  const keywords = LANG_KEYWORDS[lang] || LANG_KEYWORDS['javascript'] || new Set();

  while (pos < line.length) {
    const remaining = line.slice(pos);

    // ===== Whitespace =====
    const wsMatch = remaining.match(/^\s+/);
    if (wsMatch) {
      tokens.push({ type: 'text', value: wsMatch[0] });
      pos += wsMatch[0].length;
      continue;
    }

    // ===== Comments =====
    // Single-line comments: // # --
    if (remaining.startsWith('//') || remaining.startsWith('#') ||
        (lang === 'sql' && remaining.startsWith('--'))) {
      tokens.push({ type: 'comment', value: remaining });
      break;
    }
    // JSDoc/Multiline start
    if (remaining.startsWith('/*') || remaining.startsWith('"""') || remaining.startsWith("'''")) {
      tokens.push({ type: 'comment', value: remaining });
      break;
    }

    // ===== Decorators (Python @decorator, TypeScript @Component) =====
    if (remaining.startsWith('@')) {
      const decorMatch = remaining.match(/^@[a-zA-Z_][a-zA-Z0-9_]*/);
      if (decorMatch) {
        tokens.push({ type: 'decorator', value: decorMatch[0] });
        pos += decorMatch[0].length;
        continue;
      }
    }

    // ===== Strings =====
    // Template strings with interpolation ${...}
    if (remaining.startsWith('`')) {
      let endIdx = 1;
      while (endIdx < remaining.length) {
        if (remaining[endIdx] === '`' && remaining[endIdx - 1] !== '\\') {
          endIdx++;
          break;
        }
        endIdx++;
      }
      const str = remaining.slice(0, endIdx);
      // Split on ${...} for interpolation highlighting
      const interpParts = str.split(/(\$\{[^}]*\})/g);
      for (const part of interpParts) {
        if (part.startsWith('${') && part.endsWith('}')) {
          tokens.push({ type: 'interpolation', value: part });
        } else if (part) {
          tokens.push({ type: 'string', value: part });
        }
      }
      pos += str.length;
      continue;
    }

    // Regular strings (single/double quotes)
    const strMatch = remaining.match(/^(['"])(?:[^\\]|\\.)*?\1/);
    if (strMatch) {
      tokens.push({ type: 'string', value: strMatch[0] });
      pos += strMatch[0].length;
      continue;
    }

    // Triple-quoted strings (Python) - simplified
    if (remaining.startsWith('"""') || remaining.startsWith("'''")) {
      tokens.push({ type: 'string', value: remaining });
      break;
    }

    // ===== RegExp (simplified - /.../) =====
    // Only if preceded by operator or at start
    if (remaining.startsWith('/') && remaining.length > 1 && remaining[1] !== '/') {
      const regexMatch = remaining.match(/^\/(?:[^/\\]|\\.)+\/[gimsuy]*/);
      if (regexMatch) {
        tokens.push({ type: 'regexp', value: regexMatch[0] });
        pos += regexMatch[0].length;
        continue;
      }
    }

    // ===== Numbers =====
    // Hex: 0x..., Binary: 0b..., Octal: 0o..., Float: 1.5, Scientific: 1e10
    const numMatch = remaining.match(/^(?:0[xX][0-9a-fA-F_]+|0[bB][01_]+|0[oO][0-7_]+|\d[\d_]*(?:\.\d[\d_]*)?(?:[eE][+-]?\d+)?)/);
    if (numMatch) {
      tokens.push({ type: 'number', value: numMatch[0] });
      pos += numMatch[0].length;
      continue;
    }

    // ===== Identifiers =====
    const wordMatch = remaining.match(/^[a-zA-Z_$][a-zA-Z0-9_$]*/);
    if (wordMatch) {
      const word = wordMatch[0];
      const lowerWord = word.toLowerCase();

      // Check what follows to determine type
      const afterWord = remaining.slice(word.length);
      const isFollowedByParen = /^\s*\(/.test(afterWord);
      const isFollowedByColon = /^\s*:/.test(afterWord);
      const isPrecededByDot = tokens.length > 0 && tokens[tokens.length - 1].value === '.';

      // Determine token type
      let type: TokenType = 'variable';

      if (keywords.has(word) || keywords.has(lowerWord)) {
        type = 'keyword';
      } else if (LITERALS.has(word)) {
        type = 'literal';
      } else if (BUILTINS.has(word)) {
        type = 'builtin';
      } else if (TYPE_KEYWORDS.has(word) || TYPE_KEYWORDS.has(lowerWord)) {
        type = 'type';
      } else if (isPrecededByDot) {
        // After a dot - could be property or method
        type = isFollowedByParen ? 'function' : 'property';
      } else if (isFollowedByParen) {
        // Function call
        type = 'function';
      } else if (word[0] === word[0].toUpperCase() && word[0] !== word[0].toLowerCase()) {
        // PascalCase = likely type/class/component
        type = 'type';
      }

      tokens.push({ type, value: word });
      pos += word.length;
      continue;
    }

    // ===== Operators =====
    const opMatch = remaining.match(/^(?:===|!==|==|!=|<=|>=|=>|->|\+\+|--|\+\=|-\=|\*\=|\/\=|&&|\|\||<<|>>|[+\-*/%=<>!&|^~?:])/);
    if (opMatch) {
      tokens.push({ type: 'operator', value: opMatch[0] });
      pos += opMatch[0].length;
      continue;
    }

    // ===== Punctuation =====
    const punctMatch = remaining.match(/^[{}[\]();,.<>]/);
    if (punctMatch) {
      // JSX/HTML tags
      if (lang === 'javascript' || lang === 'typescript') {
        if (punctMatch[0] === '<') {
          // Check if it looks like a tag <Component or <div
          const tagMatch = remaining.match(/^<\/?([A-Za-z][A-Za-z0-9]*)/);
          if (tagMatch) {
            tokens.push({ type: 'punctuation', value: '<' });
            if (remaining[1] === '/') {
              tokens.push({ type: 'punctuation', value: '/' });
              pos += 2;
            } else {
              pos += 1;
            }
            tokens.push({ type: 'tag', value: tagMatch[1] });
            pos += tagMatch[1].length;
            continue;
          }
        }
      }
      tokens.push({ type: 'punctuation', value: punctMatch[0] });
      pos += punctMatch[0].length;
      continue;
    }

    // ===== Unknown single character =====
    tokens.push({ type: 'text', value: remaining[0] });
    pos++;
  }

  return tokens;
}

// Color mapping for token types
const TOKEN_COLORS: Record<TokenType, string> = {
  keyword: COLORS.syntax.keyword,       // Purple
  builtin: COLORS.syntax.builtin,       // Blue
  type: COLORS.syntax.type,             // Yellow
  literal: COLORS.syntax.literal,       // Red
  number: COLORS.syntax.number,         // Orange
  string: COLORS.syntax.string,         // Green
  comment: COLORS.syntax.comment,       // Gray
  function: COLORS.syntax.function,     // Blue
  operator: COLORS.syntax.operator,     // Cyan
  property: COLORS.syntax.property,     // Coral
  variable: COLORS.syntax.variable,     // White
  punctuation: COLORS.syntax.punctuation, // Cyan
  tag: COLORS.syntax.tag,               // Coral
  attribute: COLORS.syntax.attribute,   // Purple
  regexp: COLORS.syntax.regexp,         // Cyan
  decorator: '#C792EA',                 // Purple (same as keyword)
  interpolation: '#82AAFF',             // Blue
  text: COLORS.text,                    // Default text
};

// Main syntax highlighting function
function highlightLine(line: string, lang?: string): JSX.Element {
  const normalizedLang = normalizeLanguage(lang);

  // Special case: no highlighting for plain text
  if (normalizedLang === 'text' || !lang) {
    return <Text color={COLORS.text}>{line}</Text>;
  }

  const tokens = tokenizeLine(line, normalizedLang);

  if (tokens.length === 0) {
    return <Text color={COLORS.text}>{line}</Text>;
  }

  return (
    <>
      {tokens.map((token, i) => (
        <Text key={i} color={TOKEN_COLORS[token.type]}>{token.value}</Text>
      ))}
    </>
  );
}

// Financial text highlighting - makes currency, percentages, and metrics pop
function highlightFinancials(text: string): JSX.Element {
  const parts: JSX.Element[] = [];
  let remaining = text;
  let key = 0;

  // Patterns to match (in order of priority)
  const patterns: Array<{ regex: RegExp; color: string; bold?: boolean }> = [
    // Section headers (Key Performance Summary:, Performance Trends:, Location Performance:)
    { regex: /^(?:Key Performance|Performance|Location|Summary|Overview|Insights|Analysis|Trends|Breakdown)(?:\s+\w+)*:/, color: COLORS.info, bold: true },
    // Positive percentage change (+12%, +5.5%)
    { regex: /^\+\d+(?:\.\d+)?%/, color: COLORS.success, bold: true },
    // Negative percentage change (-12%, -5.5%)
    { regex: /^-\d+(?:\.\d+)?%/, color: COLORS.error, bold: true },
    // Currency with commas ($393,082, $4,250.50)
    { regex: /^\$[\d,]+(?:\.\d{2})?/, color: COLORS.success, bold: true },
    // Negative currency (-$500, ($500))
    { regex: /^-\$[\d,]+(?:\.\d{2})?/, color: COLORS.error, bold: true },
    { regex: /^\(\$[\d,]+(?:\.\d{2})?\)/, color: COLORS.error, bold: true },
    // Regular percentage (39%, 5.5%)
    { regex: /^\d+(?:\.\d+)?%/, color: COLORS.secondary },
    // Large numbers with commas (7,822)
    { regex: /^\d{1,3}(?:,\d{3})+(?:\.\d+)?/, color: COLORS.warning },
    // Key metric labels (before colon)
    { regex: /^(?:Total Revenue|Revenue|Total Orders|Orders|Average Order Value|Daily Average|AOV|Units|Quantity)(?=:)/, color: COLORS.info },
    // Location/store names
    { regex: /^(?:Blowing Rock|Charlotte|Elizabethton|Monroe|Main Street)(?=\s|,|$)/, color: COLORS.primary },
    // Dates and periods (Oct 21, Jan 18, Dec 18th, Q1 2024)
    { regex: /^(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d{1,2}(?:st|nd|rd|th)?(?:,?\s+\d{4})?/, color: COLORS.textMuted },
    { regex: /^Q[1-4]\s+\d{4}/, color: COLORS.textMuted },
    // "down" / "up" indicators
    { regex: /^(?:down|decreased|declined|fell|dropped)\b/i, color: COLORS.error },
    { regex: /^(?:up|increased|grew|rose|gained)\b/i, color: COLORS.success },
  ];

  while (remaining.length > 0) {
    let matched = false;

    for (const { regex, color, bold } of patterns) {
      const match = remaining.match(regex);
      if (match) {
        parts.push(
          <Text key={key++} color={color} bold={bold}>
            {match[0]}
          </Text>
        );
        remaining = remaining.slice(match[0].length);
        matched = true;
        break;
      }
    }

    if (!matched) {
      // Find next potential match point or take character
      let nextMatch = remaining.length;
      for (const { regex } of patterns) {
        for (let i = 1; i < remaining.length; i++) {
          if (regex.test(remaining.slice(i))) {
            nextMatch = Math.min(nextMatch, i);
            break;
          }
        }
      }

      // Output plain text up to next match
      const plainText = remaining.slice(0, nextMatch);
      parts.push(<Text key={key++} color={COLORS.text}>{plainText}</Text>);
      remaining = remaining.slice(nextMatch);
    }
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
