import type { Tool, ToolResult, ToolSchema } from '../types.js';
import { ALL_SCHEMAS } from './schemas.js';
import { auditToolExecution } from '../utils/logger.js';
import { recordToolExecution } from '../services/telemetry.js';
import { readTool } from './read.js';
import { editTool } from './edit.js';
import { writeTool } from './write.js';
import { globTool } from './glob.js';
import { grepTool } from './grep.js';
import { bashTool } from './bash.js';
import { lsTool } from './ls.js';
import { multiTool } from './multi.js';
import { scanTool } from './scan.js';
import { peekTool } from './peek.js';
import { sumTool } from './sum.js';
import { indexTool, searchTool, symbolTool } from './search.js';
import { fetchTool, supabaseFetchTool } from './fetch.js';
import { envTool } from './env.js';
import { storeTools, storeSchemas } from './store.js';
// Xcode & iOS development tools
import { xcodeTools } from './xcode.js';
// Project management tools (npm, git, bun)
import { devTools } from './dev.js';
// Dev server management
import { devServerTools } from './devserver.js';
// Debug & feedback tools
import { debugTools } from './debug.js';
// Workflow & tool chaining
import { workflowTools, WorkflowSchema } from './workflow.js';
// Core infrastructure (hooks, task manager)
import { setupDefaultHooks, runPreHooks, runPostHooks, analyzeError, setIndexInvalidationCallback } from './core/hooks.js';
// Index invalidation
import { invalidateCodebaseIndex } from '../services/api.js';

// Initialize default hooks on module load
setupDefaultHooks();

// Wire up index invalidation callback
setIndexInvalidationCallback(invalidateCodebaseIndex);

// =============================================================================
// Tool Registry
// =============================================================================

export const tools: Record<string, Tool> = {
  // File system tools
  Read: readTool,
  Edit: editTool,
  Write: writeTool,
  Glob: globTool,
  Grep: grepTool,
  Bash: bashTool,
  LS: lsTool,
  Multi: multiTool,
  Scan: scanTool,
  Peek: peekTool,
  Sum: sumTool,
  // Search & indexing
  Index: indexTool,
  Search: searchTool,
  Symbol: symbolTool,
  // API & data
  Fetch: fetchTool,
  SupabaseFetch: supabaseFetchTool,
  Env: envTool,
  // Store configuration tools
  ...storeTools,
  // Xcode & iOS development tools
  ...xcodeTools,
  // Project management tools (npm, git, bun)
  ...devTools,
  // Dev server management
  ...devServerTools,
  // Debug & feedback tools
  ...debugTools,
  // Workflow & tool chaining
  ...workflowTools,
  // TodoWrite and AskUser are handled specially in the UI
};

export function getToolSchemas(): ToolSchema[] {
  return [...ALL_SCHEMAS, ...storeSchemas, WorkflowSchema];
}

// Create flexible lookup map with various name formats
const toolLookup: Record<string, Tool> = {};
for (const [name, tool] of Object.entries(tools)) {
  toolLookup[name] = tool;
  toolLookup[name.toLowerCase()] = tool;
  toolLookup[name.toUpperCase()] = tool;
}

// Add common aliases
toolLookup['read_file'] = tools.Read;
toolLookup['ReadFile'] = tools.Read;
toolLookup['write_file'] = tools.Write;
toolLookup['WriteFile'] = tools.Write;
toolLookup['edit_file'] = tools.Edit;
toolLookup['EditFile'] = tools.Edit;
toolLookup['list_directory'] = tools.LS;
toolLookup['ListDirectory'] = tools.LS;
toolLookup['list_files'] = tools.LS;
toolLookup['execute_bash'] = tools.Bash;
toolLookup['run_bash'] = tools.Bash;
toolLookup['shell'] = tools.Bash;
toolLookup['search'] = tools.Grep;
toolLookup['find_files'] = tools.Glob;
// Fetch aliases
toolLookup['fetch'] = tools.Fetch;
toolLookup['http'] = tools.Fetch;
toolLookup['api'] = tools.Fetch;
toolLookup['request'] = tools.Fetch;
toolLookup['WebFetch'] = tools.Fetch;
toolLookup['supabase_fetch'] = tools.SupabaseFetch;
toolLookup['supabase'] = tools.SupabaseFetch;
toolLookup['db_query'] = tools.SupabaseFetch;
// Env aliases
toolLookup['env'] = tools.Env;
toolLookup['setup'] = tools.Env;
toolLookup['configure'] = tools.Env;
toolLookup['wire_up'] = tools.Env;
toolLookup['credentials'] = tools.Env;
// Store tool aliases
toolLookup['products'] = tools.ProductList;
toolLookup['list_products'] = tools.ProductList;
toolLookup['create_product'] = tools.ProductCreate;
toolLookup['update_product'] = tools.ProductUpdate;
toolLookup['categories'] = tools.CategoryList;
toolLookup['list_categories'] = tools.CategoryList;
toolLookup['create_category'] = tools.CategoryCreate;
toolLookup['field_groups'] = tools.FieldGroupList;
toolLookup['custom_fields'] = tools.FieldGroupList;
toolLookup['pricing'] = tools.PricingTemplateList;
toolLookup['pricing_templates'] = tools.PricingTemplateList;
toolLookup['tax_rates'] = tools.TaxRateList;
toolLookup['taxes'] = tools.TaxRateList;
toolLookup['shipping'] = tools.ShippingMethodList;
toolLookup['shipping_methods'] = tools.ShippingMethodList;
toolLookup['locations'] = tools.LocationList;
toolLookup['stores'] = tools.LocationList;
toolLookup['registers'] = tools.RegisterList;
toolLookup['pos_registers'] = tools.RegisterList;
toolLookup['payment_processors'] = tools.PaymentProcessorList;
toolLookup['processors'] = tools.PaymentProcessorList;
toolLookup['store_config'] = tools.StoreConfigGet;
toolLookup['config'] = tools.StoreConfigGet;
toolLookup['inventory'] = tools.InventoryLowStock;
toolLookup['low_stock'] = tools.InventoryLowStock;
toolLookup['adjust_inventory'] = tools.InventoryAdjust;
toolLookup['stock_adjust'] = tools.InventoryAdjust;
toolLookup['coupons'] = tools.CouponList;
toolLookup['discounts'] = tools.CouponList;
toolLookup['create_coupon'] = tools.CouponCreate;
toolLookup['validate_coupon'] = tools.CouponValidate;

// Xcode tool aliases
toolLookup['xcodebuild'] = tools.XcodeBuild;
toolLookup['xcode_build'] = tools.XcodeBuild;
toolLookup['build_xcode'] = tools.XcodeBuild;
toolLookup['simctl'] = tools.Simctl;
toolLookup['simulator'] = tools.Simctl;
toolLookup['ios_simulator'] = tools.Simctl;
toolLookup['xcrun'] = tools.Xcrun;
toolLookup['swift_package'] = tools.SwiftPackage;
toolLookup['spm'] = tools.SwiftPackage;
toolLookup['xcode_select'] = tools.XcodeSelect;
toolLookup['xcode-select'] = tools.XcodeSelect;

// npm/yarn/bun tool aliases
toolLookup['npm'] = tools.Npm;
toolLookup['npm_install'] = tools.Npm;
toolLookup['npm_run'] = tools.Npm;
toolLookup['yarn'] = tools.Npm; // npm tool handles yarn-like operations
toolLookup['git'] = tools.Git;
toolLookup['git_status'] = tools.Git;
toolLookup['git_commit'] = tools.Git;
toolLookup['bun'] = tools.Bun;
toolLookup['bun_run'] = tools.Bun;

// Dev server aliases
toolLookup['devserver'] = tools.DevServer;
toolLookup['dev_server'] = tools.DevServer;
toolLookup['server'] = tools.DevServer;
toolLookup['dev'] = tools.DevServer;

// Debug tool aliases
toolLookup['debug'] = tools.Debug;
toolLookup['analyze'] = tools.Debug;
toolLookup['diagnose'] = tools.Debug;
toolLookup['check'] = tools.Debug;
toolLookup['health'] = tools.Debug;

// Workflow tool aliases
toolLookup['workflow'] = tools.Workflow;
toolLookup['chain'] = tools.Workflow;
toolLookup['pipeline'] = tools.Workflow;
toolLookup['safe_edit'] = tools.Workflow;
toolLookup['build_test'] = tools.Workflow;

// Special tools (handled in useTools but need lookup registration)
// Create placeholder tools for TodoWrite and AskUser
const specialPlaceholder: Tool = {
  name: 'Special',
  description: 'Handled specially in useTools',
  async execute() {
    return { success: true, message: 'Handled in useTools' };
  },
};
toolLookup['TodoWrite'] = specialPlaceholder;
toolLookup['todowrite'] = specialPlaceholder;
toolLookup['TODOWRITE'] = specialPlaceholder;
toolLookup['AskUser'] = specialPlaceholder;
toolLookup['askuser'] = specialPlaceholder;
toolLookup['ASKUSER'] = specialPlaceholder;
toolLookup['AskUserQuestion'] = specialPlaceholder;
toolLookup['askuserquestion'] = specialPlaceholder;

export async function executeToolByName(
  name: string,
  params: Record<string, unknown>,
  conversationId?: string
): Promise<ToolResult> {
  const startTime = Date.now();

  // Try exact match first, then lowercase
  const tool = toolLookup[name] || toolLookup[name.toLowerCase()];

  if (!tool) {
    const result = {
      success: false,
      error: `Unknown tool: ${name}. Available: ${Object.keys(tools).join(', ')}`,
    };
    auditToolExecution(name, params, result);
    recordToolExecution({
      tool_name: name,
      execution_time_ms: Date.now() - startTime,
      result_status: 'error',
      error_message: result.error,
    });
    return result;
  }

  try {
    const result = await tool.execute(params);
    const executionTime = Date.now() - startTime;

    // Local audit log
    auditToolExecution(name, params, result);

    // Backend telemetry
    recordToolExecution({
      tool_name: name,
      execution_time_ms: executionTime,
      result_status: result.success ? 'success' : 'error',
      error_message: result.error,
      conversation_id: conversationId,
    });

    return result;
  } catch (error) {
    const executionTime = Date.now() - startTime;
    const result = {
      success: false,
      error: error instanceof Error ? error.message : 'Tool execution failed',
    };

    auditToolExecution(name, params, result);
    recordToolExecution({
      tool_name: name,
      execution_time_ms: executionTime,
      result_status: 'error',
      error_message: result.error,
      conversation_id: conversationId,
    });

    return result;
  }
}
