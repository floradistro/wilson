import { Box, Text } from 'ink';

interface TableProps {
  title?: string;
  headers: string[];
  rows: (string | number)[][];
  maxRows?: number;
}

export function Table({ title, headers, rows, maxRows = 10 }: TableProps) {
  if (!headers || !rows || rows.length === 0) {
    return <Text dimColor>No data</Text>;
  }

  // Calculate column widths
  const columnWidths = headers.map((header, i) => {
    const headerWidth = header.length;
    const maxDataWidth = Math.max(...rows.map((row) => String(row[i] || '').length));
    return Math.max(headerWidth, maxDataWidth, 4);
  });

  const displayRows = rows.slice(0, maxRows);
  const totalWidth = columnWidths.reduce((sum, w) => sum + w + 3, 0);

  return (
    <Box flexDirection="column">
      {title && (
        <>
          <Text bold color="white">{title}</Text>
          <Text dimColor>{'─'.repeat(totalWidth)}</Text>
        </>
      )}

      {/* Headers */}
      <Box>
        <Text>  </Text>
        {headers.map((header, i) => (
          <Box key={i} width={columnWidths[i] + 3}>
            <Text bold>{header}</Text>
          </Box>
        ))}
      </Box>

      {/* Rows */}
      {displayRows.map((row, rowIndex) => (
        <Box key={rowIndex}>
          <Text>  </Text>
          {row.map((cell, i) => {
            const value = String(cell || '');
            const color = value.startsWith('$') ? 'green'
              : value.startsWith('-') ? 'red'
              : undefined;

            return (
              <Box key={i} width={columnWidths[i] + 3}>
                <Text color={color}>{value}</Text>
              </Box>
            );
          })}
        </Box>
      ))}

      {rows.length > maxRows && (
        <Text dimColor>  +{rows.length - maxRows} more</Text>
      )}
    </Box>
  );
}
