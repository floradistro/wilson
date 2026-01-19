import { Box, Text, useStdout } from 'ink';
import { COLORS } from '../../theme/colors.js';

interface MetricItem {
  label: string;
  value: string | number;
  trend?: string;
}

interface MetricsCardProps {
  title?: string;
  data: MetricItem[];
}

/**
 * Format and colorize a metric value
 */
function formatMetricValue(value: string | number): {
  text: string;
  color: string;
  bgColor?: string;
  bold?: boolean;
} {
  const v = String(value).trim();

  // Currency values - green and bold
  if (v.startsWith('$')) {
    return { text: v, color: COLORS.success, bold: true };
  }

  // Positive percentage - green background
  if (v.startsWith('+') && v.endsWith('%')) {
    return { text: ` ${v} `, color: '#000', bgColor: COLORS.success, bold: true };
  }

  // Negative percentage - red background
  if (v.startsWith('-') && v.endsWith('%')) {
    return { text: ` ${v} `, color: '#000', bgColor: COLORS.error, bold: true };
  }

  // Regular percentage - cyan
  if (v.endsWith('%')) {
    return { text: v, color: COLORS.secondary };
  }

  // Numbers - amber
  if (/^[\d,]+$/.test(v)) {
    return { text: v, color: COLORS.warning, bold: true };
  }

  // Default
  return { text: v, color: COLORS.text };
}

/**
 * KPI metrics display with professional financial formatting
 */
export function MetricsCard({ title, data }: MetricsCardProps) {
  const { stdout } = useStdout();
  const termWidth = stdout?.columns || 80;

  if (!data || data.length === 0) return null;

  const maxLabel = Math.min(Math.max(...data.map(m => m.label.length), 8), 16);
  const dividerWidth = Math.min(termWidth - 4, 50);
  const dividerChar = '─';

  return (
    <Box flexDirection="column" gap={0}>
      {/* Title with divider */}
      {title && (
        <Box flexDirection="column" marginBottom={1}>
          <Text bold color={COLORS.info}>{title}</Text>
          <Text color={COLORS.border}>{dividerChar.repeat(dividerWidth)}</Text>
        </Box>
      )}

      {/* Metrics grid */}
      {data.slice(0, 10).map(({ label, value, trend }, i) => {
        const { text, color, bgColor, bold } = formatMetricValue(value);

        // Trend indicator colors
        let trendColor = COLORS.textDim;
        let trendSymbol = '';
        if (trend === 'up' || trend === '+' || trend === '↑') {
          trendColor = COLORS.success;
          trendSymbol = ' ↑';
        } else if (trend === 'down' || trend === '-' || trend === '↓') {
          trendColor = COLORS.error;
          trendSymbol = ' ↓';
        }

        return (
          <Box key={i} gap={1}>
            <Text color={COLORS.textMuted}>{label.padEnd(maxLabel)}</Text>
            <Text color={color} backgroundColor={bgColor} bold={bold}>
              {text}
            </Text>
            {trendSymbol && <Text color={trendColor}>{trendSymbol}</Text>}
          </Box>
        );
      })}

      {/* Bottom divider */}
      <Box marginTop={1}>
        <Text color={COLORS.border}>{dividerChar.repeat(dividerWidth)}</Text>
      </Box>
    </Box>
  );
}
