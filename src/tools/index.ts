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
// Inventory Transfer tools
import { transferTools, transferSchemas } from './transfer.js';
// Location context management
import { locationContextTools, locationContextSchemas } from './location-context.js';
// Xcode & iOS development tools
import { xcodeTools } from './xcode.js';
// Project management tools (npm, git, bun)
import { devTools } from './dev.js';
// DevServer REMOVED - use Bash tool instead (auto-detects servers and runs in background)
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
  // Inventory Transfer tools
  ...transferTools,
  // Location context management
  ...locationContextTools,
  // Xcode & iOS development tools
  ...xcodeTools,
  // Project management tools (npm, git, bun)
  ...devTools,
  // DevServer REMOVED - use Bash (auto-runs servers in background)
  // Debug & feedback tools
  ...debugTools,
  // Workflow & tool chaining
  ...workflowTools,
  // TodoWrite and AskUser are handled specially in the UI
};

export function getToolSchemas(): ToolSchema[] {
  return [...ALL_SCHEMAS, ...storeSchemas, ...transferSchemas, ...locationContextSchemas, WorkflowSchema];
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
// Products
toolLookup['products'] = tools.ProductList;
toolLookup['list_products'] = tools.ProductList;
toolLookup['products_search'] = tools.ProductList;
toolLookup['Products_find'] = tools.ProductList;  // Wilson tries this!
toolLookup['find_products'] = tools.ProductList;
toolLookup['search_products'] = tools.ProductList;
toolLookup['get_products'] = tools.ProductList;
toolLookup['Products_at_location'] = tools.ProductList;  // Wilson tries this too!
toolLookup['products_at_location'] = tools.ProductList;
toolLookup['create_product'] = tools.ProductCreate;
toolLookup['update_product'] = tools.ProductUpdate;
// Categories
toolLookup['categories'] = tools.CategoryList;
toolLookup['list_categories'] = tools.CategoryList;
toolLookup['create_category'] = tools.CategoryCreate;
// Field Groups
toolLookup['field_groups'] = tools.FieldGroupList;
toolLookup['custom_fields'] = tools.FieldGroupList;
// Pricing
toolLookup['pricing'] = tools.PricingTemplateList;
toolLookup['pricing_templates'] = tools.PricingTemplateList;
// Tax & Shipping
toolLookup['tax_rates'] = tools.TaxRateList;
toolLookup['taxes'] = tools.TaxRateList;
toolLookup['shipping'] = tools.ShippingMethodList;
toolLookup['shipping_methods'] = tools.ShippingMethodList;
// Locations (THE FIX FOR THE LOOP ISSUE!)
toolLookup['locations'] = tools.LocationList;
toolLookup['stores'] = tools.LocationList;
toolLookup['locations_find'] = tools.LocationList;  // lowercase
toolLookup['Locations_find'] = tools.LocationList;  // CamelCase - Wilson tries this!
toolLookup['find_locations'] = tools.LocationList;
toolLookup['get_locations'] = tools.LocationList;
toolLookup['list_locations'] = tools.LocationList;
toolLookup['search_locations'] = tools.LocationList;
toolLookup['location_list'] = tools.LocationList;
toolLookup['create_location'] = tools.LocationCreate;
// Registers
toolLookup['registers'] = tools.RegisterList;
toolLookup['pos_registers'] = tools.RegisterList;
// Payment Processors
toolLookup['payment_processors'] = tools.PaymentProcessorList;
toolLookup['processors'] = tools.PaymentProcessorList;
// Store Config
toolLookup['store_config'] = tools.StoreConfigGet;
toolLookup['config'] = tools.StoreConfigGet;
// Inventory
toolLookup['inventory'] = tools.InventoryLowStock;
toolLookup['low_stock'] = tools.InventoryLowStock;
toolLookup['adjust_inventory'] = tools.InventoryAdjust;
toolLookup['stock_adjust'] = tools.InventoryAdjust;
// Coupons
toolLookup['coupons'] = tools.CouponList;
toolLookup['discounts'] = tools.CouponList;
toolLookup['create_coupon'] = tools.CouponCreate;
toolLookup['validate_coupon'] = tools.CouponValidate;

// Transfer tool aliases
toolLookup['transfer'] = tools.TransferInventory;
toolLookup['transfer_inventory'] = tools.TransferInventory;
toolLookup['Transfer_inventory'] = tools.TransferInventory;  // Wilson tried this! ✅
toolLookup['Transferinventory'] = tools.TransferInventory;  // Wilson tried this first
toolLookup['transferinventory'] = tools.TransferInventory;
toolLookup['move_inventory'] = tools.TransferInventory;
toolLookup['inventory_transfer'] = tools.TransferInventory;

// Location context tool aliases
toolLookup['set_location'] = tools.SetLocationContext;
toolLookup['switch_location'] = tools.SetLocationContext;
toolLookup['change_location'] = tools.SetLocationContext;
toolLookup['location_context'] = tools.GetLocationContext;
toolLookup['get_location'] = tools.GetLocationContext;
toolLookup['current_location'] = tools.GetLocationContext;

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

// Dev server aliases REMOVED - use Bash tool instead
// Example: Bash { command: "npm run dev" } - auto-runs in background

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
  toolId?: string
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
    // Pass toolId to tools that support streaming
    const result = await tool.execute(params, toolId);
    const executionTime = Date.now() - startTime;

    // Local audit log
    auditToolExecution(name, params, result);

    // Backend telemetry
    recordToolExecution({
      tool_name: name,
      execution_time_ms: executionTime,
      result_status: result.success ? 'success' : 'error',
      error_message: result.error,
      conversation_id: toolId,
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
      conversation_id: toolId,
    });

    return result;
  }
}
