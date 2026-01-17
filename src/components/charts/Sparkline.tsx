import { Box, Text } from 'ink';
import { sparkline as generateSparkline, formatNumber, formatChange } from '../../utils/format.js';

interface SparklineProps {
  title?: string;
  values: number[];
  showChange?: boolean;
}

export function Sparkline({ title, values, showChange = true }: SparklineProps) {
  if (!values || values.length === 0) {
    return <Text dimColor>No data</Text>;
  }

  const spark = generateSparkline(values);
  const first = values[0];
  const last = values[values.length - 1];
  const isUp = last >= first;

  return (
    <Box flexDirection="column">
      {title && <Text bold color="white">{title}</Text>}

      <Box>
        <Text color="cyan">{spark}</Text>
        {showChange && (
          <>
            <Text>  </Text>
            <Text color={isUp ? 'green' : 'red'}>
              {isUp ? '▲' : '▼'}
            </Text>
            <Text dimColor>
              {' '}{((last - first) / first * 100).toFixed(1)}%
            </Text>
          </>
        )}
      </Box>

      <Text dimColor>
        {formatNumber(first)} → {formatNumber(last)}
      </Text>
    </Box>
  );
}
