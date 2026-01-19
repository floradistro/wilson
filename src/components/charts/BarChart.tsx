import { Box, Text } from 'ink';
import { BarChart as InkBarChart } from '@pppp606/ink-chart';
import { COLORS } from '../../theme/colors.js';

interface DataPoint {
  label: string;
  value: number;
}

interface BarChartProps {
  title?: string;
  data: DataPoint[];
  isCurrency?: boolean;
}

// Format number for display with financial styling
function fmt(v: number, isCurrency?: boolean): string {
  if (isCurrency) {
    if (v >= 1000000) return '$' + (v / 1000000).toFixed(1) + 'M';
    if (v >= 1000) return '$' + (v / 1000).toFixed(1) + 'k';
    return '$' + v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  if (v >= 1000000) return (v / 1000000).toFixed(1) + 'M';
  if (v >= 1000) return (v / 1000).toFixed(1) + 'k';
  return v.toLocaleString('en-US', { maximumFractionDigits: 0 });
}

/**
 * Bar chart using ink-chart library with financial styling
 */
export function BarChart({ title, data, isCurrency }: BarChartProps) {
  if (!data || data.length === 0) return null;

  const sum = data.reduce((s, d) => s + d.value, 0);
  const chartData = data.slice(0, 12).map(d => ({
    label: d.label.slice(0, 18),
    value: d.value,
  }));

  const dividerChar = '─';
  const dividerWidth = 50;

  return (
    <Box flexDirection="column" gap={0}>
      {/* Title */}
      {title && (
        <Box flexDirection="column" marginBottom={1}>
          <Text bold color={COLORS.info}>{title}</Text>
          <Text color={COLORS.border}>{dividerChar.repeat(dividerWidth)}</Text>
        </Box>
      )}

      {/* Bar Chart */}
      <InkBarChart
        data={chartData}
        showValue="right"
        sort="desc"
        width="full"
      />

      {/* Footer stats */}
      <Box marginTop={1}>
        <Text color={COLORS.border}>{dividerChar.repeat(dividerWidth)}</Text>
      </Box>
      <Box gap={2}>
        <Box>
          <Text color={COLORS.textMuted}>Total: </Text>
          <Text color={COLORS.success} bold>{fmt(sum, isCurrency)}</Text>
        </Box>
        <Box>
          <Text color={COLORS.textDim}>│</Text>
        </Box>
        <Box>
          <Text color={COLORS.textMuted}>{data.length} items</Text>
        </Box>
      </Box>
    </Box>
  );
}
