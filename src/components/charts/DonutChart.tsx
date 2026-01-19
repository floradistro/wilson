import { Box, Text } from 'ink';
import { BarChart as InkBarChart } from '@pppp606/ink-chart';
import { COLORS } from '../../theme/colors.js';

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

// Format number for display
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
 * Donut/pie chart - uses bar chart with percentages
 */
export function DonutChart({
  title,
  data,
  isCurrency = false,
  maxSlices = 8,
}: DonutChartProps) {
  if (!data || data.length === 0) return null;

  const total = data.reduce((sum, d) => sum + d.value, 0);
  const displayData = data.slice(0, maxSlices).map(d => ({
    label: d.label.slice(0, 16),
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

      {/* Bar Chart (used as category breakdown) */}
      <InkBarChart
        data={displayData}
        showValue="right"
        sort="desc"
        width="full"
      />

      {data.length > maxSlices && (
        <Text color={COLORS.textDim}>  +{data.length - maxSlices} more</Text>
      )}

      {/* Footer stats */}
      <Box marginTop={1}>
        <Text color={COLORS.border}>{dividerChar.repeat(dividerWidth)}</Text>
      </Box>
      <Box gap={2}>
        <Box>
          <Text color={COLORS.textMuted}>Total: </Text>
          <Text bold color={COLORS.success}>{fmt(total, isCurrency)}</Text>
        </Box>
        <Box>
          <Text color={COLORS.textDim}>│</Text>
        </Box>
        <Box>
          <Text color={COLORS.textMuted}>{data.length} categories</Text>
        </Box>
      </Box>
    </Box>
  );
}
