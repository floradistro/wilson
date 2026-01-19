import { Box, Text, useStdout } from 'ink';
import { COLORS } from '../../theme/colors.js';

interface TableProps {
  title?: string;
  headers: string[];
  rows: (string | number | null | undefined)[][];
  showRowNumbers?: boolean;
}

/**
 * Format and colorize a cell value based on its content.
 * Financial syntax highlighting:
 * - Currency ($xxx) → green bold
 * - Negative numbers/losses → red
 * - Positive changes (+xx%) → green background
 * - Negative changes (-xx%) → red background
 * - Percentages → cyan
 * - Plain numbers → amber
 */
function formatCell(value: string | number | null | undefined, header?: string): {
  text: string;
  color: string;
  bgColor?: string;
  bold?: boolean;
} {
  if (value === null || value === undefined || value === '') {
    return { text: '—', color: COLORS.textDim };
  }

  const v = String(value).trim();

  // Currency values (positive) - green bold
  if (/^\$[\d,.]+$/.test(v) || /^[\d,.]+\s*(?:USD|usd)$/.test(v)) {
    return { text: v, color: COLORS.success, bold: true };
  }

  // Negative currency - red bold
  if (/^-\$[\d,.]+$/.test(v) || /^\(\$[\d,.]+\)$/.test(v)) {
    return { text: v, color: COLORS.error, bold: true };
  }

  // Positive percentage change - green background
  if (/^\+[\d.]+%$/.test(v)) {
    return { text: ` ${v} `, color: '#000', bgColor: COLORS.success, bold: true };
  }

  // Negative percentage change - red background
  if (/^-[\d.]+%$/.test(v)) {
    return { text: ` ${v} `, color: '#000', bgColor: COLORS.error, bold: true };
  }

  // Regular percentage - cyan
  if (/^[\d.]+%$/.test(v)) {
    return { text: v, color: COLORS.secondary };
  }

  // Negative numbers - red
  if (/^-[\d,.]+$/.test(v)) {
    return { text: v, color: COLORS.error };
  }

  // Positive numbers - amber
  if (/^[\d,]+(\.\d+)?$/.test(v)) {
    return { text: v, color: COLORS.warning };
  }

  // Status indicators
  const lower = v.toLowerCase();
  if (['completed', 'success', 'active', 'paid', 'approved', 'in stock'].includes(lower)) {
    return { text: v, color: COLORS.success };
  }
  if (['failed', 'error', 'cancelled', 'rejected', 'overdue', 'out of stock'].includes(lower)) {
    return { text: v, color: COLORS.error };
  }
  if (['pending', 'processing', 'in progress', 'draft'].includes(lower)) {
    return { text: v, color: COLORS.warning };
  }

  // Default - neutral text
  return { text: v, color: COLORS.text };
}

/**
 * Professional data table with financial syntax highlighting
 */
export function Table({ title, headers, rows, showRowNumbers = false }: TableProps) {
  const { stdout } = useStdout();
  const termWidth = stdout?.columns || 80;

  if (!headers || !rows || rows.length === 0) return null;

  // Calculate column widths
  const minColWidth = 8;
  const maxColWidth = 22;
  const padding = 3;

  const widths = headers.map((h, i) => {
    const headerLen = h.length;
    const maxDataLen = Math.max(
      ...rows.slice(0, 30).map(r => String(r[i] ?? '').length)
    );
    return Math.min(Math.max(headerLen, maxDataLen, minColWidth), maxColWidth);
  });

  const rowNumWidth = showRowNumbers ? String(rows.length).length + 2 : 0;
  const totalWidth = widths.reduce((a, b) => a + b + padding, rowNumWidth);
  const dividerWidth = Math.min(totalWidth, termWidth - 2);
  const maxRows = 15;

  return (
    <Box flexDirection="column" gap={0}>
      {/* Title */}
      {title && (
        <Box marginBottom={1}>
          <Text bold color={COLORS.info}>{title}</Text>
        </Box>
      )}

      {/* Header row - bold with background highlight */}
      <Box>
        {showRowNumbers && (
          <Text color={COLORS.textDim}>{' '.repeat(rowNumWidth)}</Text>
        )}
        {headers.map((h, i) => {
          const display = h.length > widths[i]
            ? h.slice(0, widths[i] - 1) + '…'
            : h.padEnd(widths[i]);
          return (
            <Text key={i} color={COLORS.info} bold underline>
              {display}{' '.repeat(padding)}
            </Text>
          );
        })}
      </Box>

      {/* Data rows */}
      {rows.slice(0, maxRows).map((row, ri) => (
        <Box key={ri}>
          {showRowNumbers && (
            <Text color={COLORS.textDim}>
              {String(ri + 1).padStart(rowNumWidth - 1)}{' '}
            </Text>
          )}
          {row.map((cell, ci) => {
            const { text, color, bgColor, bold } = formatCell(cell, headers[ci]);
            const display = text.length > widths[ci]
              ? text.slice(0, widths[ci] - 1) + '…'
              : text.padEnd(widths[ci]);

            return (
              <Text
                key={ci}
                color={color}
                backgroundColor={bgColor}
                bold={bold}
              >
                {display}{' '.repeat(padding)}
              </Text>
            );
          })}
        </Box>
      ))}

      {/* Footer */}
      <Box marginTop={1} gap={2}>
        <Text color={COLORS.textDim}>
          {rows.length > maxRows
            ? `${maxRows} of ${rows.length} rows`
            : `${rows.length} rows`
          }
        </Text>
        {rows.length > maxRows && (
          <Text color={COLORS.textVeryDim}>
            (+{rows.length - maxRows} more)
          </Text>
        )}
      </Box>
    </Box>
  );
}

/**
 * Check if data looks like tabular data that should render as a table
 */
export function isTabularData(data: unknown): boolean {
  if (!Array.isArray(data) || data.length === 0) return false;

  const first = data[0];
  if (typeof first !== 'object' || first === null) return false;

  const keys = Object.keys(first);
  if (keys.length < 3) return false;

  const sampleRows = data.slice(0, 5);
  return sampleRows.every(row => {
    if (typeof row !== 'object' || row === null) return false;
    const rowKeys = Object.keys(row);
    return rowKeys.length === keys.length && keys.every(k => k in row);
  });
}

// Columns to hide (internal IDs, etc)
const HIDDEN_COLUMNS = ['location_id', 'category_id', 'product_id', 'employee_id', 'id', 'store_id', 'tenant_id'];

// Preferred column order (first columns appear first)
const COLUMN_ORDER = [
  'location_name', 'name', 'category_name', 'product_name', 'employee_name',
  'revenue', 'total_revenue', 'orders', 'total_orders', 'units', 'quantity',
  'avg_order_value', 'average_order_value', 'pct_of_total', 'percent'
];

// Friendly header names
const HEADER_NAMES: Record<string, string> = {
  'location_name': 'Location',
  'category_name': 'Category',
  'product_name': 'Product',
  'employee_name': 'Employee',
  'revenue': 'Revenue',
  'total_revenue': 'Revenue',
  'orders': 'Orders',
  'total_orders': 'Orders',
  'avg_order_value': 'Avg Order',
  'average_order_value': 'Avg Order',
  'pct_of_total': '% of Total',
  'units_sold': 'Units',
  'quantity': 'Qty',
  'units': 'Units',
};

/**
 * Convert array of objects to table format with smart formatting
 */
export function objectsToTable(data: Record<string, unknown>[]): {
  headers: string[];
  rows: (string | number)[][];
} {
  if (!data || data.length === 0) {
    return { headers: [], rows: [] };
  }

  // Get all keys and filter out hidden columns
  const allKeys = Object.keys(data[0]);
  const visibleKeys = allKeys.filter(k => !HIDDEN_COLUMNS.includes(k.toLowerCase()));

  // Sort columns by preferred order
  const sortedKeys = visibleKeys.sort((a, b) => {
    const aIndex = COLUMN_ORDER.findIndex(c => a.toLowerCase().includes(c));
    const bIndex = COLUMN_ORDER.findIndex(c => b.toLowerCase().includes(c));
    if (aIndex === -1 && bIndex === -1) return 0;
    if (aIndex === -1) return 1;
    if (bIndex === -1) return -1;
    return aIndex - bIndex;
  });

  // Format each row
  const rows = data.map(obj =>
    sortedKeys.map(h => {
      const val = obj[h];
      const hLower = h.toLowerCase();

      if (val === null || val === undefined) return '';

      if (typeof val === 'number') {
        // Currency formatting
        if (hLower.includes('revenue') || hLower.includes('total') ||
            hLower.includes('price') || hLower.includes('cost') ||
            hLower.includes('amount') || hLower === 'avg_order_value' ||
            hLower === 'average_order_value') {
          return '$' + val.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
        }
        // Percentage formatting
        if (hLower.includes('pct') || hLower.includes('percent')) {
          return val.toFixed(1) + '%';
        }
        // Integer formatting for counts
        if (hLower.includes('order') || hLower.includes('unit') || hLower.includes('count') || hLower.includes('qty')) {
          return val.toLocaleString('en-US', { maximumFractionDigits: 0 });
        }
        // Default number
        return val.toLocaleString('en-US', { maximumFractionDigits: 2 });
      }
      return String(val);
    })
  );

  // Create friendly header names
  const headers = sortedKeys.map(h => {
    const hLower = h.toLowerCase();
    // Check for exact match in friendly names
    if (HEADER_NAMES[hLower]) return HEADER_NAMES[hLower];
    // Fall back to title case
    return h
      .replace(/_/g, ' ')
      .replace(/([a-z])([A-Z])/g, '$1 $2')
      .split(' ')
      .map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
      .join(' ');
  });

  return { headers, rows };
}
