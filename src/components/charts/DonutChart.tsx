import { Box, Text, useStdout } from 'ink';
import { formatNumber } from '../../utils/format.js';

interface DataPoint {
  label: string;
  value: number;
}

interface DonutChartProps {
  title?: string;
  data: DataPoint[];
  isCurrency?: boolean;
  maxSlices?: number;
}

// Color palette for donut segments (Ink color names)
const COLORS = ['magenta', 'cyan', 'green', 'yellow', 'blue'] as const;

/**
 * Terminal-based donut/pie chart.
 * Displays proportional breakdown with colored bars.
 */
export function DonutChart({
  title,
  data,
  isCurrency = false,
  maxSlices = 5,
}: DonutChartProps) {
  const { stdout } = useStdout();
  const termWidth = stdout?.columns || 80;

  if (!data || data.length === 0) {
    return <Text dimColor>No data</Text>;
  }

  const total = data.reduce((sum, d) => sum + d.value, 0);
  const labelWidth = Math.min(Math.max(...data.map((d) => d.label.length), 12), 16);
  const displayData = data.slice(0, maxSlices);
  const dividerWidth = Math.max(20, Math.min(termWidth - 10, 50));

  return (
    <Box flexDirection="column">
      {title && (
        <>
          <Text bold color="white">{title}</Text>
          <Text dimColor>{'─'.repeat(dividerWidth)}</Text>
        </>
      )}

      {displayData.map(({ label, value }, index) => {
        const pct = total > 0 ? Math.round((value / total) * 100) : 0;
        const barLength = Math.round(pct / 4); // Max ~25 chars for 100%
        const displayLabel = label.length > labelWidth
          ? label.slice(0, labelWidth - 1) + '…'
          : label.padEnd(labelWidth);
        const color = COLORS[index % COLORS.length];

        return (
          <Box key={label}>
            <Text color="white">{displayLabel}</Text>
            <Text> </Text>
            <Text color={color}>{'█'.repeat(barLength).padEnd(25)}</Text>
            <Text> </Text>
            <Text color="green">{formatNumber(value, isCurrency)}</Text>
            <Text dimColor> ({pct}%)</Text>
          </Box>
        );
      })}

      {/* Show remaining count if truncated */}
      {data.length > maxSlices && (
        <Text dimColor>  +{data.length - maxSlices} more</Text>
      )}

      <Text dimColor>{'─'.repeat(dividerWidth)}</Text>

      {/* Total row */}
      <Box>
        <Text bold>{'Total'.padEnd(labelWidth)}</Text>
        <Text> </Text>
        <Text>{' '.repeat(25)}</Text>
        <Text> </Text>
        <Text bold color="green">{formatNumber(total, isCurrency)}</Text>
      </Box>
    </Box>
  );
}
