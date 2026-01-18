import { Box, Text } from 'ink';

interface TableProps {
  title?: string;
  headers: string[];
  rows: (string | number)[][];
}

/**
 * Simple text table - Claude Code style
 */
export function Table({ title, headers, rows }: TableProps) {
  if (!headers || !rows || rows.length === 0) return null;

  const widths = headers.map((h, i) =>
    Math.max(h.length, ...rows.map(r => String(r[i] || '').length))
  );

  return (
    <Box flexDirection="column">
      {title && <Text color="#888">{title}</Text>}
      <Text>
        {headers.map((h, i) => (
          <Text key={i} color="#888">{h.padEnd(widths[i] + 2)}</Text>
        ))}
      </Text>
      {rows.slice(0, 10).map((row, ri) => (
        <Text key={ri}>
          {row.map((cell, ci) => {
            const v = String(cell || '');
            const color = v.startsWith('$') ? '#7DC87D' : v.startsWith('-') ? '#E07070' : '#E8E8E8';
            return <Text key={ci} color={color}>{v.padEnd(widths[ci] + 2)}</Text>;
          })}
        </Text>
      ))}
      {rows.length > 10 && <Text color="#555">+{rows.length - 10} more</Text>}
    </Box>
  );
}
