import { Box, Text } from 'ink';

interface DataPoint {
  label: string;
  value: number;
}

interface BarChartProps {
  title?: string;
  data: DataPoint[];
  isCurrency?: boolean;
}

/**
 * Simple ASCII bar chart - Claude Code style
 */
export function BarChart({ title, data, isCurrency }: BarChartProps) {
  if (!data || data.length === 0) return null;

  const max = Math.max(...data.map(d => d.value));
  const labelWidth = Math.max(...data.map(d => d.label.length), 8);
  const barWidth = 20;

  const fmt = (v: number) => isCurrency
    ? '$' + v.toLocaleString('en-US', { maximumFractionDigits: 0 })
    : v.toLocaleString('en-US');

  return (
    <Box flexDirection="column">
      {title && <Text color="#888">{title}</Text>}
      {data.slice(0, 8).map(({ label, value }, i) => {
        const len = max > 0 ? Math.round((value / max) * barWidth) : 0;
        return (
          <Text key={i}>
            <Text color="#888">{label.slice(0, labelWidth).padEnd(labelWidth)} </Text>
            <Text color="#C792EA">{'█'.repeat(Math.max(1, len))}</Text>
            <Text color="#7DC87D"> {fmt(value)}</Text>
          </Text>
        );
      })}
    </Box>
  );
}
