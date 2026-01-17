import { Box, Text } from 'ink';

interface ChartData {
  label: string;
  value: number;
}

interface BarChartProps {
  title: string;
  data: ChartData[];
  isCurrency?: boolean;
}

const SPARK_CHARS = '▁▂▃▄▅▆▇█';

function formatNumber(n: number, isCurrency = false): string {
  const prefix = isCurrency ? '$' : '';
  if (n >= 1e6) return prefix + (n / 1e6).toFixed(1) + 'M';
  if (n >= 1e3) return prefix + (n / 1e3).toFixed(1) + 'K';
  return prefix + Math.round(n).toLocaleString();
}

function sparkline(vals: number[]): string {
  if (!vals?.length) return '';
  const min = Math.min(...vals);
  const max = Math.max(...vals);
  const range = max - min || 1;
  return vals.map((v) => SPARK_CHARS[Math.min(7, Math.floor(((v - min) / range) * 7))]).join('');
}

export function BarChart({ title, data, isCurrency = false }: BarChartProps) {
  if (!data || data.length === 0) return null;

  const max = Math.max(...data.map((d) => d.value));
  const total = data.reduce((sum, d) => sum + d.value, 0);
  const labelWidth = Math.min(Math.max(...data.map((d) => d.label.length), 8), 18);

  return (
    <Box flexDirection="column" marginY={1}>
      <Text bold color="white">{title}</Text>
      <Text dimColor>{'─'.repeat(55)}</Text>

      {data.slice(0, 8).map((item, i) => {
        const barWidth = Math.round((item.value / max) * 24);
        const displayLabel =
          item.label.length > labelWidth ? item.label.slice(0, labelWidth - 1) + '…' : item.label;
        const pct = total > 0 ? Math.round((item.value / total) * 100) : 0;

        return (
          <Box key={i}>
            <Text color="white">{displayLabel.padEnd(labelWidth)}</Text>
            <Text>  </Text>
            <Text color="magenta">{'█'.repeat(barWidth)}</Text>
            <Text> </Text>
            <Text color="green">{formatNumber(item.value, isCurrency)}</Text>
            <Text dimColor> ({pct}%)</Text>
          </Box>
        );
      })}

      <Text dimColor>{'─'.repeat(55)}</Text>
      <Box>
        <Text bold>{'Total'.padEnd(labelWidth)}</Text>
        <Text>  </Text>
        <Text>{' '.repeat(24)}</Text>
        <Text> </Text>
        <Text bold color="green">{formatNumber(total, isCurrency)}</Text>
      </Box>
    </Box>
  );
}

interface LineChartProps {
  title: string;
  data: ChartData[];
}

export function LineChart({ title, data }: LineChartProps) {
  if (!data || data.length === 0) return null;

  const vals = data.map((d) => d.value);
  const spark = sparkline(vals);
  const first = vals[0];
  const last = vals[vals.length - 1];
  const pctChange = first ? ((last - first) / first * 100).toFixed(1) : '0';
  const isUp = last >= first;

  return (
    <Box flexDirection="column" marginY={1}>
      <Text bold color="white">{title}</Text>
      <Box marginTop={1}>
        <Text color="cyan">{spark}</Text>
      </Box>
      <Box>
        <Text dimColor>
          {formatNumber(first)} → {formatNumber(last)}
        </Text>
        <Text> </Text>
        <Text color={isUp ? 'green' : 'red'}>
          {isUp ? '▲' : '▼'} {pctChange}%
        </Text>
      </Box>
    </Box>
  );
}
