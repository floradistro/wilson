import { Box, Text } from 'ink';
import type { ChartData, ChartResponse } from '../../types.js';
import { BarChart } from './BarChart.js';
import { LineChart } from './LineChart.js';
import { DonutChart } from './DonutChart.js';
import { MetricsCard } from './MetricsCard.js';
import { Table } from './Table.js';

interface ChartRendererProps {
  /** Raw data that may contain chart configuration */
  data: unknown;
  /** Fallback title if not specified in chart data */
  fallbackTitle?: string;
}

/**
 * Auto-detecting chart renderer.
 *
 * Attempts to extract and render chart data from various formats:
 * 1. Explicit chart structure: { chart: { type, title, data } }
 * 2. Direct chart data: { type, title, data }
 * 3. Auto-detected from data arrays with label/value patterns
 *
 * Returns null if no chart data is detected.
 */
export function ChartRenderer({ data, fallbackTitle }: ChartRendererProps): JSX.Element | null {
  const chartData = extractChartData(data, fallbackTitle);

  if (!chartData) {
    return null;
  }

  return (
    <Box marginY={1}>
      {renderChart(chartData)}
    </Box>
  );
}

/**
 * Render the appropriate chart component based on type.
 */
function renderChart(chart: ChartData): JSX.Element {
  switch (chart.type) {
    case 'bar':
      return (
        <BarChart
          title={chart.title}
          data={chart.data}
          isCurrency={chart.isCurrency}
        />
      );

    case 'line':
      return (
        <LineChart
          title={chart.title}
          data={chart.data}
        />
      );

    case 'donut':
    case 'pie':
      return (
        <DonutChart
          title={chart.title}
          data={chart.data}
          isCurrency={(chart as { isCurrency?: boolean }).isCurrency}
        />
      );

    case 'metrics':
      return (
        <MetricsCard
          title={chart.title}
          data={chart.data}
        />
      );

    case 'table':
      return (
        <Table
          title={chart.title}
          headers={chart.headers}
          rows={chart.rows}
        />
      );

    default:
      return <Text dimColor>Unknown chart type</Text>;
  }
}

/**
 * Extract chart data from various input formats.
 */
function extractChartData(data: unknown, fallbackTitle?: string): ChartData | null {
  // Handle null/undefined
  if (!data) {
    return null;
  }

  // Handle JSON string (tool results often come as JSON strings)
  if (typeof data === 'string') {
    try {
      const parsed = JSON.parse(data);
      return extractChartData(parsed, fallbackTitle);
    } catch {
      return null;
    }
  }

  if (typeof data !== 'object') {
    return null;
  }

  const obj = data as Record<string, unknown>;

  // Check if there's a content field that might be JSON (common in tool results)
  if (typeof obj.content === 'string' && obj.content.trim().startsWith('{')) {
    try {
      const parsed = JSON.parse(obj.content);
      const chartFromContent = extractChartData(parsed, fallbackTitle);
      if (chartFromContent) {
        return chartFromContent;
      }
    } catch {
      // Continue with normal extraction
    }
  }

  // Check if there's a data field that might be JSON string (MCP tool results)
  if (typeof obj.data === 'string') {
    const trimmed = obj.data.trim();
    if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
      try {
        const parsed = JSON.parse(obj.data);
        const chartFromData = extractChartData(parsed, fallbackTitle);
        if (chartFromData) {
          return chartFromData;
        }
      } catch {
        // Continue with normal extraction
      }
    }
  }

  // Case 1: Explicit chart wrapper { chart: { ... } }
  if (obj.chart && typeof obj.chart === 'object') {
    const chart = obj.chart as Record<string, unknown>;
    if (isValidChartData(chart)) {
      return chart as ChartData;
    }
  }

  // Case 2: Direct chart data { type: 'bar', data: [...] }
  if (isValidChartData(obj)) {
    return obj as ChartData;
  }

  // Case 3: Auto-detect from the current object (handles query_type at top level)
  // This MUST run before checking nested obj.data to handle analytics responses
  const autoDetected = autoDetectChart(obj, fallbackTitle);
  if (autoDetected) {
    return autoDetected;
  }

  // Case 4: Check if data is already a parsed object (direct MCP result)
  // Only check this if autoDetect didn't match - prevents double-processing
  if (obj.data && typeof obj.data === 'object' && !Array.isArray(obj.data)) {
    const chartFromData = extractChartData(obj.data, fallbackTitle);
    if (chartFromData) {
      return chartFromData;
    }
  }

  return null;
}

/**
 * Validate that an object has the required chart structure.
 */
function isValidChartData(obj: Record<string, unknown>): boolean {
  const type = obj.type;

  if (typeof type !== 'string') {
    return false;
  }

  // Table chart has different structure
  if (type === 'table') {
    return Array.isArray(obj.headers) && Array.isArray(obj.rows);
  }

  // Metrics chart has different data structure
  if (type === 'metrics') {
    return Array.isArray(obj.data) && obj.data.length > 0;
  }

  // Standard charts need data array with label/value
  if (!Array.isArray(obj.data) || obj.data.length === 0) {
    return false;
  }

  const firstItem = obj.data[0] as Record<string, unknown>;
  return (
    typeof firstItem === 'object' &&
    'label' in firstItem &&
    'value' in firstItem
  );
}

/**
 * Auto-detect chart type from data structure.
 * Follows Lisa CLI's tryRenderChart pattern.
 */
function autoDetectChart(
  obj: Record<string, unknown>,
  fallbackTitle?: string
): ChartData | null {
  // Check for analytics summary response (flat object with metrics)
  // Shape: { data: { orders: 123, revenue: 456.78, ... }, period: {...}, query_type: "summary" }
  if (obj.query_type === 'summary' || obj.query_type === 'sales_summary') {
    const data = obj.data as Record<string, unknown>;
    if (data && typeof data === 'object' && !Array.isArray(data)) {
      return convertToMetrics(data, obj, fallbackTitle);
    }
  }

  // Check for flat data object (metrics/KPIs) - no query_type but has numeric values
  if (obj.data && typeof obj.data === 'object' && !Array.isArray(obj.data)) {
    const data = obj.data as Record<string, unknown>;
    const numericKeys = Object.keys(data).filter(k => typeof data[k] === 'number');
    if (numericKeys.length >= 3) {
      return convertToMetrics(data, obj, fallbackTitle);
    }
  }

  // Look for data arrays in common response shapes
  const rows = obj.data ?? obj.results ?? obj.rows;

  if (!Array.isArray(rows) || rows.length === 0) {
    return null;
  }

  const firstRow = rows[0] as Record<string, unknown>;
  if (typeof firstRow !== 'object' || firstRow === null) {
    return null;
  }

  const keys = Object.keys(firstRow);

  // Find label and value keys
  const labelKey = keys.find((k) =>
    /name|label|category|product|date|day|month|week/i.test(k)
  );

  const valueKey =
    keys.find((k) => /^total_revenue$|^revenue$|^total_sales$|^sales$/i.test(k)) ??
    keys.find((k) => /revenue|sales|amount/i.test(k)) ??
    keys.find((k) => /^total$|^value$|^sum$/i.test(k)) ??
    keys.find((k) => /count|qty|units|quantity/i.test(k));

  if (!labelKey || !valueKey) {
    return null;
  }

  // Determine if currency based on key name
  const isCurrency = /revenue|sales|amount|total(?!_count)/i.test(valueKey);

  // Convert to chart data
  const chartData = rows.slice(0, 10).map((row) => {
    const r = row as Record<string, unknown>;
    return {
      label: String(r[labelKey] ?? '').slice(0, 20),
      value: parseNumericValue(r[valueKey]),
    };
  });

  // Generate title from key name or fallback
  const prettyTitle =
    fallbackTitle ??
    valueKey
      .replace(/_/g, ' ')
      .replace(/\b\w/g, (c) => c.toUpperCase());

  // Determine chart type based on label key
  if (/date|day|week|month/i.test(labelKey)) {
    return {
      type: 'line',
      title: prettyTitle,
      data: chartData,
    };
  }

  return {
    type: 'bar',
    title: prettyTitle,
    data: chartData,
    isCurrency,
  };
}

/**
 * Convert flat metrics object to chart data
 */
function convertToMetrics(
  data: Record<string, unknown>,
  obj: Record<string, unknown>,
  fallbackTitle?: string
): ChartData {
  // Define display order and formatting for common metrics
  const metricConfig: Record<string, { label: string; isCurrency?: boolean; isPercent?: boolean }> = {
    revenue: { label: 'Revenue', isCurrency: true },
    total_revenue: { label: 'Revenue', isCurrency: true },
    orders: { label: 'Orders' },
    total_orders: { label: 'Orders' },
    avg_order_value: { label: 'Avg Order', isCurrency: true },
    average_order_value: { label: 'Avg Order', isCurrency: true },
    avg_daily_revenue: { label: 'Daily Avg', isCurrency: true },
    tax: { label: 'Tax', isCurrency: true },
    tax_collected: { label: 'Tax', isCurrency: true },
    discounts: { label: 'Discounts', isCurrency: true },
    discounts_applied: { label: 'Discounts', isCurrency: true },
    unique_customers: { label: 'Customers' },
    units: { label: 'Units Sold' },
    items: { label: 'Items' },
    pct_change_revenue: { label: 'Change', isPercent: true },
  };

  const metrics: Array<{ label: string; value: number | string; trend?: string }> = [];

  // Process data in preferred order
  const orderedKeys = ['revenue', 'total_revenue', 'orders', 'total_orders', 'avg_order_value',
    'average_order_value', 'avg_daily_revenue', 'unique_customers', 'units', 'items', 'tax',
    'tax_collected', 'discounts', 'discounts_applied'];

  const seenLabels = new Set<string>();

  for (const key of orderedKeys) {
    if (key in data && data[key] !== undefined && data[key] !== null) {
      const config = metricConfig[key];
      if (config && !seenLabels.has(config.label)) {
        seenLabels.add(config.label);
        const val = data[key] as number;
        let displayVal: string;
        if (config.isCurrency) {
          displayVal = '$' + val.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
        } else if (config.isPercent) {
          displayVal = (val >= 0 ? '+' : '') + val.toFixed(1) + '%';
        } else {
          displayVal = val.toLocaleString('en-US', { maximumFractionDigits: 0 });
        }
        metrics.push({ label: config.label, value: displayVal });
      }
    }
  }

  // Add comparison data if present
  const comparison = obj.comparison as Record<string, unknown> | undefined;
  if (comparison?.data) {
    const compData = comparison.data as Record<string, unknown>;
    if (typeof compData.pct_change_revenue === 'number') {
      const pct = compData.pct_change_revenue as number;
      const trend = pct >= 0 ? '↑' : '↓';
      metrics.push({
        label: 'vs Prior',
        value: (pct >= 0 ? '+' : '') + pct.toFixed(1) + '%',
        trend: trend
      });
    }
  }

  // Get period info for title
  const period = obj.period as Record<string, unknown> | undefined;
  let title = fallbackTitle || 'Summary';
  if (period?.type) {
    const periodType = String(period.type).replace(/_/g, ' ');
    title = periodType.charAt(0).toUpperCase() + periodType.slice(1) + ' Summary';
  }

  return {
    type: 'metrics',
    title,
    data: metrics as any,
  };
}

/**
 * Parse a value into a number, handling currency strings.
 */
function parseNumericValue(value: unknown): number {
  if (typeof value === 'number') {
    return value;
  }

  if (typeof value === 'string') {
    // Remove currency symbols and commas
    const cleaned = value.replace(/[^0-9.-]/g, '');
    const parsed = parseFloat(cleaned);
    return isNaN(parsed) ? 0 : parsed;
  }

  return 0;
}

/**
 * Check if data contains renderable chart data.
 * Useful for conditional rendering.
 *
 * Handles:
 * - Objects with chart property
 * - Direct chart data
 * - JSON strings that parse to chart data
 * - Tool result objects with content field
 */
export function hasChartData(data: unknown): boolean {
  return extractChartData(data) !== null;
}
