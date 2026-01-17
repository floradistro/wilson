import { Box, Text } from 'ink';
import { formatNumber } from '../../utils/format.js';

interface DataPoint {
  label: string;
  value: number;
}

interface BarChartProps {
  title?: string;
  data: DataPoint[];
  isCurrency?: boolean;
  maxBars?: number;
}

export function BarChart({ title, data, isCurrency = false, maxBars = 8 }: BarChartProps) {
  if (!data || data.length === 0) {
    return <Text dimColor>No data</Text>;
  }

  const max = Math.max(...data.map((d) => d.value));
  const total = data.reduce((sum, d) => sum + d.value, 0);
  const labelWidth = Math.min(Math.max(...data.map((d) => d.label.length), 8), 18);
  const barWidth = 24;

  const displayData = data.slice(0, maxBars);

  return (
    <Box flexDirection="column">
      {title && (
        <>
          <Text bold color="white">{title}</Text>
          <Text dimColor>{'─'.repeat(55)}</Text>
        </>
      )}

      {displayData.map(({ label, value }) => {
        const barLength = Math.round((value / max) * barWidth);
        const pct = total > 0 ? Math.round((value / total) * 100) : 0;
        const displayLabel = label.length > labelWidth
          ? label.slice(0, labelWidth - 1) + '…'
          : label.padEnd(labelWidth);

        return (
          <Box key={label}>
            <Text color="white">{displayLabel}</Text>
            <Text>  </Text>
            <Text color="magenta">{'█'.repeat(barLength)}</Text>
            <Text> </Text>
            <Text color="green">{formatNumber(value, isCurrency)}</Text>
            <Text dimColor> ({pct}%)</Text>
          </Box>
        );
      })}

      <Text dimColor>{'─'.repeat(55)}</Text>
      <Box>
        <Text bold>{'Total'.padEnd(labelWidth)}</Text>
        <Text>  </Text>
        <Text>{' '.repeat(barWidth)}</Text>
        <Text> </Text>
        <Text bold color="green">{formatNumber(total, isCurrency)}</Text>
      </Box>
    </Box>
  );
}
