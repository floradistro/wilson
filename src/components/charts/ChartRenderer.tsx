import { Box, Text } from 'ink';
import type { ChartData, ChartResponse } from '../../types.js';
import { BarChart } from './BarChart.js';
import { LineChart } from './LineChart.js';
import { DonutChart } from './DonutChart.js';
import { MetricsCard } from './MetricsCard.js';
import { Table, isTabularData, objectsToTable } from './Table.js';

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
          isCurrency={(chart as { isCurrency?: boolean }).isCurrency}
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
      // Return null for unknown types instead of showing error
      return <></>;
  }
}

/**
 * Extract chart data from various input formats.
 * Simplified to avoid multiple extraction paths causing duplicate detection.
 */
function extractChartData(data: unknown, fallbackTitle?: string): ChartData | null {
  // Unwrap to get the actual data object
  const obj = unwrapData(data);
  if (!obj) return null;

  // Priority 1: Explicit chart wrapper { chart: { type, data } }
  if (obj.chart && typeof obj.chart === 'object') {
    const chart = obj.chart as Record<string, unknown>;
    if (isValidChartData(chart)) {
      return chart as ChartData;
    }
  }

  // Priority 2: Direct chart data { type: 'bar', data: [...] }
  if (isValidChartData(obj)) {
    return obj as ChartData;
  }

  // Priority 3: Auto-detect from data structure (analytics responses)
  return autoDetectChart(obj, fallbackTitle);
}

/**
 * Unwrap nested data structures to get the actual object.
 * Handles JSON strings, content wrappers, etc.
 */
function unwrapData(data: unknown): Record<string, unknown> | null {
  if (!data) return null;

  // Parse JSON string
  if (typeof data === 'string') {
    try {
      return unwrapData(JSON.parse(data));
    } catch {
      return null;
    }
  }

  if (typeof data !== 'object') return null;

  const obj = data as Record<string, unknown>;

  // Unwrap content field if it's JSON
  if (typeof obj.content === 'string' && obj.content.trim().startsWith('{')) {
    try {
      const parsed = JSON.parse(obj.content);
      if (typeof parsed === 'object' && parsed !== null) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      // Continue with obj
    }
  }

  // Unwrap data field if it's JSON string
  if (typeof obj.data === 'string') {
    const trimmed = obj.data.trim();
    if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
      try {
        const parsed = JSON.parse(obj.data);
        if (typeof parsed === 'object' && parsed !== null) {
          return parsed as Record<string, unknown>;
        }
      } catch {
        // Continue with obj
      }
    }
  }

  return obj;
}

// Valid chart types we can render
const VALID_CHART_TYPES = ['bar', 'line', 'donut', 'pie', 'metrics', 'table'];

/**
 * Validate that an object has the required chart structure.
 */
function isValidChartData(obj: Record<string, unknown>): boolean {
  const type = obj.type;

  if (typeof type !== 'string') {
    return false;
  }

  // Must be a known chart type
  if (!VALID_CHART_TYPES.includes(type)) {
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

  // Check for explicit chart_type hint from backend
  const hintedType = obj.chart_type as string | undefined;

  // Look for data arrays in common response shapes
  const rows = obj.data ?? obj.results ?? obj.rows;

  if (!Array.isArray(rows) || rows.length === 0) {
    return null;
  }

  // Check if this looks like tabular data (many columns, structured rows)
  // Render as table if: 4+ columns, or has non-numeric columns besides the label
  if (isTabularData(rows)) {
    const firstRow = rows[0] as Record<string, unknown>;
    const keys = Object.keys(firstRow);

    // If it has location_name, category_name etc - it's a breakdown, render as table
    const hasNameColumns = keys.some(k => /name|location|category|product|employee/i.test(k));
    const hasMultipleMetrics = keys.filter(k => /revenue|orders|qty|count|amount|total|avg/i.test(k)).length >= 2;

    if (hasNameColumns && hasMultipleMetrics) {
      const { headers, rows: tableRows } = objectsToTable(rows as Record<string, unknown>[]);
      const period = obj.period as Record<string, unknown> | undefined;
      let title = fallbackTitle || '';
      if (period?.type) {
        const periodType = String(period.type).replace(/_/g, ' ');
        title = periodType.charAt(0).toUpperCase() + periodType.slice(1);
      }
      if (obj.query_type === 'by_location') {
        title = title ? `${title} by Location` : 'Revenue by Location';
      }

      return {
        type: 'table',
        title,
        headers,
        rows: tableRows,
      } as ChartData;
    }
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
  // For time series (line charts), keep all data points; for others, limit to 15
  const isTimeSeries = /^date$|_date$|^day$|^week$|^month$/i.test(labelKey);
  const maxItems = isTimeSeries ? 100 : 15;
  const chartData = rows.slice(0, maxItems).map((row) => {
    const r = row as Record<string, unknown>;
    return {
      label: String(r[labelKey] ?? '').slice(0, 20),
      value: parseNumericValue(r[valueKey]),
    };
  });

  // Generate title based on query_type, label key, or value key
  let prettyTitle = fallbackTitle || '';
  const queryType = obj.query_type as string | undefined;
  const period = obj.period as Record<string, unknown> | undefined;
  const lkLower = labelKey.toLowerCase();

  if (queryType === 'trend') {
    prettyTitle = 'Revenue Trend';
    if (period?.start && period?.end) {
      prettyTitle += ` (${period.start} to ${period.end})`;
    }
  } else if (queryType === 'by_location') {
    prettyTitle = 'Revenue by Location';
  } else if (queryType === 'by_category') {
    prettyTitle = 'Revenue by Category';
  } else if (queryType === 'by_product') {
    prettyTitle = 'Top Products';
  } else if (/category/i.test(lkLower)) {
    // Auto-detect category breakdown from Database_query results
    prettyTitle = 'Revenue by Category';
  } else if (/product/i.test(lkLower)) {
    // Auto-detect product breakdown from Database_query results
    prettyTitle = 'Top Products by Revenue';
  } else if (!prettyTitle) {
    prettyTitle = valueKey
      .replace(/_/g, ' ')
      .replace(/\b\w/g, (c) => c.toUpperCase());
  }

  // Determine chart type based on data characteristics
  const chartType = detectChartType(labelKey, valueKey, chartData.length, isCurrency, hintedType);

  return {
    type: chartType,
    title: prettyTitle,
    data: chartData,
    isCurrency,
  };
}

/**
 * Detect best chart type based on data characteristics.
 */
function detectChartType(
  labelKey: string,
  _valueKey: string,
  dataLength: number,
  _isCurrency: boolean,
  hintedType?: string
): 'bar' | 'line' | 'donut' | 'pie' {
  // If backend provided explicit chart_type hint, use it
  if (hintedType && ['bar', 'line', 'donut', 'pie'].includes(hintedType)) {
    return hintedType as 'bar' | 'line' | 'donut' | 'pie';
  }

  const lk = labelKey.toLowerCase();

  // Line chart for time series (date in label key)
  if (/^date$|_date$|^day$|^week$|^month$/.test(lk)) {
    return 'line';
  }

  // Bar chart for category/product breakdowns (most common business chart)
  // These benefit from bar chart's ability to show labels clearly
  if (/category|product|name/i.test(lk)) {
    return 'bar';
  }

  // Donut chart for very small datasets (2-4 items) with segment-like labels
  // Good for: types, segments, groups, statuses
  if (dataLength >= 2 && dataLength <= 4) {
    if (/type|segment|group|kind|class|status/i.test(lk)) {
      return 'donut';
    }
  }

  // Default to bar chart - it's the most versatile
  return 'bar';
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
