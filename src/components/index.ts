/**
 * Wilson Components
 */

// Terminal Visualizer - beautiful command/action rendering
export {
  ActionRow,
  ActionList,
  CommandDisplay,
  StepProgress,
  TestResults,
  LogStream,
  CodeBlock,
  Divider,
  type Action,
  type ActionStatus,
  type Step,
  type TestResult,
  type CommandResult,
  type ActionListProps,
  type CommandDisplayProps,
} from './TerminalVisualizer.js';

// Core UI
export { default as Spinner } from './Spinner.js';
export { default as Footer } from './Footer.js';
export { default as StatusBar } from './StatusBar.js';
export { default as Chat } from './Chat.js';
export { default as Input } from './Input.js';
export { default as Markdown } from './Markdown.js';
export { default as TodoList } from './TodoList.js';
export { default as ErrorBoundary } from './ErrorBoundary.js';

// Charts
export { default as BarChart } from './charts/BarChart.js';
export { default as Table } from './charts/Table.js';

// Enhanced components - Apple-level polish
export { EnhancedInput } from './EnhancedInput.js';
export { EnhancedStatusBar } from './EnhancedStatusBar.js';
export { EnhancedSpinner, LoadingState } from './EnhancedSpinner.js';
export { ContextualHelp, SmartTips } from './ContextualHelp.js';
export { EnhancedErrorBoundary } from './EnhancedErrorBoundary.js';
