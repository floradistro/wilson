// =============================================================================
// Formatting Utilities
// =============================================================================

/**
 * Format a number with K/M/B suffixes
 */
export function formatNumber(n: number, isCurrency = false): string {
  const prefix = isCurrency ? '$' : '';

  if (n >= 1e9) return `${prefix}${(n / 1e9).toFixed(1)}B`;
  if (n >= 1e6) return `${prefix}${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `${prefix}${(n / 1e3).toFixed(1)}K`;

  return `${prefix}${Math.round(n).toLocaleString()}`;
}

/**
 * Format bytes as human-readable size
 */
export function formatBytes(bytes: number): string {
  if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(1)}GB`;
  if (bytes >= 1e6) return `${(bytes / 1e6).toFixed(1)}MB`;
  if (bytes >= 1e3) return `${(bytes / 1e3).toFixed(1)}KB`;
  return `${bytes}B`;
}

/**
 * Format duration in milliseconds as human-readable
 */
export function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  if (ms < 3600000) return `${Math.floor(ms / 60000)}m ${Math.floor((ms % 60000) / 1000)}s`;
  return `${Math.floor(ms / 3600000)}h ${Math.floor((ms % 3600000) / 60000)}m`;
}

/**
 * Truncate a string with ellipsis
 */
export function truncate(str: string, maxLength: number): string {
  if (str.length <= maxLength) return str;
  return str.slice(0, maxLength - 3) + '...';
}

/**
 * Pad a string to a fixed width
 */
export function padRight(str: string, width: number): string {
  if (str.length >= width) return str.slice(0, width);
  return str + ' '.repeat(width - str.length);
}

export function padLeft(str: string, width: number): string {
  if (str.length >= width) return str.slice(-width);
  return ' '.repeat(width - str.length) + str;
}

/**
 * Generate sparkline characters for a series of values
 */
const SPARK_CHARS = '▁▂▃▄▅▆▇█';

export function sparkline(values: number[]): string {
  if (!values || values.length === 0) return '';

  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;

  return values
    .map((v) => {
      const index = Math.min(7, Math.floor(((v - min) / range) * 7));
      return SPARK_CHARS[index];
    })
    .join('');
}

/**
 * Format a percentage change with arrow
 */
export function formatChange(current: number, previous: number): string {
  if (previous === 0) return '—';

  const change = ((current - previous) / previous) * 100;
  const arrow = change >= 0 ? '▲' : '▼';
  const sign = change >= 0 ? '+' : '';

  return `${arrow} ${sign}${change.toFixed(1)}%`;
}
