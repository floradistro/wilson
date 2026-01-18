/**
 * Terminal Chart Components
 *
 * Ink-based chart rendering for CLI visualization.
 * Follows Lisa CLI patterns for consistent UX across clients.
 */

// Individual chart components
export { BarChart } from './BarChart.js';
export { LineChart } from './LineChart.js';
export { DonutChart } from './DonutChart.js';
export { MetricsCard } from './MetricsCard.js';
export { Sparkline } from './Sparkline.js';
export { Table } from './Table.js';

// Auto-detecting chart renderer
export { ChartRenderer, hasChartData } from './ChartRenderer.js';
