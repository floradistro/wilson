/**
 * Wilson Core Tools Infrastructure
 *
 * Anthropic-style improvements:
 * - Hooks system (pre/post execution)
 * - Smart editing with fuzzy matching
 * - Task manager for background processes
 * - Workflow chaining
 * - Self-correction loops
 */

// Hooks system
export {
  registerPreHook,
  registerPostHook,
  runPreHooks,
  runPostHooks,
  recordFileRead,
  hasRecentlyRead,
  getLastReadContent,
  clearFileCache,
  analyzeError,
  recordCorrectionAttempt,
  getRecentCorrections,
  setupDefaultHooks,
  type HookContext,
  type PreHookResult,
  type PostHookResult,
  type FollowUpAction,
  type PreHook,
  type PostHook,
  type ErrorPattern,
  type CorrectionAttempt,
} from './hooks.js';

// Smart edit
export {
  smartEdit,
  validateEditParams,
  type SmartEditParams,
} from './smart-edit.js';

// Task manager
export {
  taskRegistry,
  runTask,
  killTask,
  killTaskByName,
  killTaskByPid,
  getTaskOutput,
  getTaskErrors,
  discoverProcesses,
  getPortsInUse,
  checkTaskHealth,
  type TaskInfo,
  type TaskOptions,
  type SystemProcess,
} from './task-manager.js';

// Workflows
export {
  registerWorkflow,
  getWorkflow,
  listWorkflows,
  executeWorkflow,
  readForEdit,
  runAndAnalyze,
  findAndSuggestFix,
  runHealthCheck,
  retryWithBackoff,
  suggestEditCorrection,
  type WorkflowStep,
  type WorkflowResult,
  type WorkflowDefinition,
} from './workflows.js';
