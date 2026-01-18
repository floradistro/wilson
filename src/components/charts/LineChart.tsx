import { Box, Text } from 'ink';

interface DataPoint {
  label: string;
  value: number;
}

interface LineChartProps {
  title?: string;
  data: DataPoint[];
}

// Sparkline characters (low to high)
const SPARKS = '▁▂▃▄▅▆▇█';

function sparkline(values: number[]): string {
  if (!values.length) return '';
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  return values.map(v => SPARKS[Math.floor(((v - min) / range) * 7)]).join('');
}

/**
 * Simple sparkline chart - Claude Code style
 */
export function LineChart({ title, data }: LineChartProps) {
  if (!data || data.length === 0) return null;

  const values = data.map(d => d.value);
  const spark = sparkline(values);
  const first = values[0];
  const last = values[values.length - 1];
  const pct = first !== 0 ? ((last - first) / first) * 100 : 0;

  return (
    <Box flexDirection="column">
      {title && <Text color="#888">{title}</Text>}
      <Text>
        <Text color="#82AAFF">{spark}</Text>
        <Text color={pct >= 0 ? '#7DC87D' : '#E07070'}> {pct >= 0 ? '↑' : '↓'}{Math.abs(pct).toFixed(1)}%</Text>
      </Text>
    </Box>
  );
}
