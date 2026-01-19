import { Box, Text } from 'ink';
import { LineGraph } from '@pppp606/ink-chart';
import { COLORS } from '../../theme/colors.js';

interface DataPoint {
  label: string;
  value: number;
}

interface LineChartProps {
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
 * Line chart using ink-chart LineGraph with financial styling
 */
export function LineChart({ title, data, isCurrency }: LineChartProps) {
  if (!data || data.length === 0) return null;

  const values = data.map(d => d.value);
  const first = values[0];
  const last = values[values.length - 1];
  const min = Math.min(...values);
  const max = Math.max(...values);
  const sum = values.reduce((a, b) => a + b, 0);
  const avg = sum / values.length;
  const pct = first !== 0 ? ((last - first) / first) * 100 : 0;

  const firstLabel = data[0]?.label || '';
  const lastLabel = data[data.length - 1]?.label || '';

  // X-axis labels - first and last
  const xLabels = [firstLabel, lastLabel];

  const dividerChar = '─';
  const dividerWidth = 60;

  return (
    <Box flexDirection="column" gap={0}>
      {/* Title */}
      {title && (
        <Box flexDirection="column" marginBottom={1}>
          <Text bold color={COLORS.info}>{title}</Text>
          <Text color={COLORS.border}>{dividerChar.repeat(dividerWidth)}</Text>
        </Box>
      )}

      {/* Period */}
      <Text color={COLORS.textDim}>{firstLabel} → {lastLabel} ({data.length} periods)</Text>

      {/* Line Graph - full width, 6 rows tall */}
      <Box marginY={1}>
        <LineGraph
          data={[{ values, color: COLORS.info }]}
          width="full"
          height={6}
          showYAxis={true}
          xLabels={xLabels}
        />
      </Box>

      {/* Stats with financial styling */}
      <Text color={COLORS.border}>{dividerChar.repeat(dividerWidth)}</Text>

      <Box gap={2}>
        <Box>
          <Text color={COLORS.textMuted}>Total: </Text>
          <Text color={COLORS.success} bold>{fmt(sum, isCurrency)}</Text>
        </Box>
        <Text color={COLORS.textDim}>│</Text>
        <Box>
          <Text color={COLORS.textMuted}>Avg: </Text>
          <Text color={COLORS.warning}>{fmt(avg, isCurrency)}</Text>
        </Box>
        <Text color={COLORS.textDim}>│</Text>
        <Box>
          <Text color={COLORS.textMuted}>Change: </Text>
          <Text
            color={pct >= 0 ? '#000' : '#000'}
            backgroundColor={pct >= 0 ? COLORS.success : COLORS.error}
            bold
          >
            {' '}{pct >= 0 ? '+' : ''}{pct.toFixed(1)}%{' '}
          </Text>
        </Box>
      </Box>

      {/* Range */}
      <Box gap={2}>
        <Box>
          <Text color={COLORS.textMuted}>Range: </Text>
          <Text color={COLORS.text}>{fmt(min, isCurrency)}</Text>
          <Text color={COLORS.textDim}> → </Text>
          <Text color={COLORS.text}>{fmt(max, isCurrency)}</Text>
        </Box>
      </Box>
    </Box>
  );
}
