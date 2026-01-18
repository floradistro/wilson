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

// =============================================================================
// Tool Registry
// =============================================================================

export const tools: Record<string, Tool> = {
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
  Index: indexTool,
  Search: searchTool,
  Symbol: symbolTool,
  Fetch: fetchTool,
  SupabaseFetch: supabaseFetchTool,
  Env: envTool,
  // Store configuration tools
  ...storeTools,
  // TodoWrite and AskUser are handled specially in the UI
};

export function getToolSchemas(): ToolSchema[] {
  return [...ALL_SCHEMAS, ...storeSchemas];
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
