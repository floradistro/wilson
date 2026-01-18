import { Box, Text } from 'ink';

interface MetricItem {
  label: string;
  value: string | number;
}

interface MetricsCardProps {
  title?: string;
  data: MetricItem[];
}

/**
 * Clean metrics display
 */
export function MetricsCard({ title, data }: MetricsCardProps) {
  if (!data || data.length === 0) return null;

  const maxLabel = Math.max(...data.map(m => m.label.length));

  return (
    <Box flexDirection="column">
      {title && <Text bold color="#82AAFF">{title}</Text>}
      {data.slice(0, 8).map(({ label, value }, i) => {
        const v = String(value);
        const color = v.includes('$') ? '#7DC87D' : v.includes('%') ? (v.startsWith('-') ? '#E07070' : '#7DC87D') : '#E8E8E8';
        return (
          <Text key={i}>
            <Text color="#666">{label.padEnd(maxLabel + 2)}</Text>
            <Text color={color} bold>{v}</Text>
          </Text>
        );
      })}
    </Box>
  );
}
