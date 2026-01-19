import type { Tool, ToolResult, ToolSchema } from '../types.js';
import { readFileSync, existsSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';

// =============================================================================
// Inventory Transfer Tool - Anthropic Best Practices
// =============================================================================

interface TransferContext {
  apiUrl: string;
  anonKey: string;
  serviceKey?: string;
  authToken?: string;
  storeId?: string;
  userId?: string;
}

/**
 * Load authentication context
 */
function loadTransferContext(): TransferContext | null {
  const apiUrl = process.env.WILSON_API_URL ||  'https://uaednwpxursknmwdeejn.supabase.co';
  const anonKey = process.env.WILSON_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVhZWRud3B4dXJza25td2RlZWpuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjA5OTcyMzMsImV4cCI6MjA3NjU3MzIzM30.N8jPwlyCBB5KJB5I-XaK6m-mq88rSR445AWFJJmwRCg';
  const serviceKey = process.env.WILSON_SERVICE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVhZWRud3B4dXJza25td2RlZWpuIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2MDk5NzIzMywiZXhwIjoyMDc2NTczMjMzfQ.l0NvBbS2JQWPObtWeVD2M2LD866A2tgLmModARYNnbI';

  // Try to get store_id from env first, then fallback to auth.json
  let storeId = process.env.WILSON_STORE_ID;

  if (!apiUrl || !anonKey) {
    return null;
  }

  let authToken: string | undefined;
  let userId: string | undefined;

  try {
    const authPath = join(homedir(), '.wilson', 'auth.json');
    if (existsSync(authPath)) {
      const auth = JSON.parse(readFileSync(authPath, 'utf-8'));
      authToken = auth.accessToken;
      userId = auth.user?.id;
      // Fallback: Use store_id from auth.json if not in env
      if (!storeId && auth.storeId) {
        storeId = auth.storeId;
      }
    }
  } catch {
    // Ignore
  }

  return { apiUrl, anonKey, serviceKey, authToken, storeId, userId };
}

/**
 * Call Supabase RPC function
 */
async function callRPC<T = unknown>(
  ctx: TransferContext,
  functionName: string,
  params: Record<string, unknown>
): Promise<{ data: T | null; error: string | null }> {
  const bearerToken = ctx.serviceKey || ctx.authToken || ctx.anonKey;

  try {
    const response = await fetch(`${ctx.apiUrl}/rest/v1/rpc/${functionName}`, {
      method: 'POST',
      headers: {
        'apikey': ctx.anonKey,
        'Authorization': `Bearer ${bearerToken}`,
        'Content-Type': 'application/json',
        'Prefer': 'return=representation',
      },
      body: JSON.stringify(params),
    });

    if (!response.ok) {
      const error = await response.json();
      return { data: null, error: error.message || JSON.stringify(error) };
    }

    const data = await response.json();
    return { data: data as T, error: null };
  } catch (error) {
    return { data: null, error: error instanceof Error ? error.message : 'Request failed' };
  }
}

// =============================================================================
// Tool Schema - Following Anthropic's Type-Safe Design
// =============================================================================

export const TransferInventorySchema: ToolSchema = {
  name: 'TransferInventory',
  description: `Transfer inventory between locations with automatic validation, atomic transactions, and full audit logging.

This tool consolidates all transfer operations:
- Validates source inventory availability
- Executes atomic database transaction (all-or-nothing)
- Updates inventory at both locations
- Creates complete audit trail
- Returns semantic transfer ID for tracking
- Returns FULLY FORMATTED output (no additional visualization needed)

Use this for:
- Store restocking
- Location rebalancing
- New store openings
- Damage replacements
- Audit corrections

IMPORTANT: After calling this tool, the transfer is complete. DO NOT attempt to create visualizations, HTML dashboards, or use browser tools. The tool response contains all necessary information in a formatted, ready-to-display format.`,
  parameters: {
    type: 'object',
    properties: {
      store_id: {
        type: 'string',
        description: 'Store UUID (optional - defaults to WILSON_STORE_ID environment variable)'
      },
      from_location_id: {
        type: 'string',
        description: 'Source location UUID (where inventory comes from)'
      },
      to_location_id: {
        type: 'string',
        description: 'Destination location UUID (where inventory goes to)'
      },
      items: {
        type: 'array',
        description: 'Products to transfer. Can transfer multiple products in one operation.',
        items: {
          type: 'object',
          properties: {
            product_id: {
              type: 'string',
              description: 'Product UUID'
            },
            quantity: {
              type: 'number',
              description: 'Quantity to transfer (must be positive integer)'
            },
            unit: {
              type: 'string',
              description: 'Unit of measurement (default: "g" for grams)',
              enum: ['g', 'kg', 'oz', 'lb', 'units']
            }
          },
          required: ['product_id', 'quantity']
        },
        minItems: 1
      },
      reason: {
        type: 'string',
        enum: ['restock', 'store_opening', 'damage_replacement', 'audit_correction', 'customer_order'],
        description: 'Reason for transfer (for audit trail and compliance)'
      },
      notes: {
        type: 'string',
        description: 'Optional notes for audit trail'
      },
      auto_complete: {
        type: 'boolean',
        description: 'If true, immediately complete transfer. If false, create draft for manual approval (default: true)'
      }
    },
    required: ['from_location_id', 'to_location_id', 'items', 'reason']
  }
};

// =============================================================================
// Tool Implementation
// =============================================================================

export const transferInventoryTool: Tool = {
  schema: TransferInventorySchema,

  async execute(params: Record<string, unknown>): Promise<ToolResult> {
    const ctx = loadTransferContext();
    if (!ctx) {
      return {
        success: false,
        error: 'Missing Supabase configuration. Set WILSON_API_URL and WILSON_ANON_KEY.'
      };
    }

    const {
      store_id,
      from_location_id,
      to_location_id,
      items,
      reason,
      notes,
      auto_complete = true
    } = params as {
      store_id?: string;
      from_location_id: string;
      to_location_id: string;
      items: Array<{ product_id: string; quantity: number; unit?: string }>;
      reason: string;
      notes?: string;
      auto_complete?: boolean;
    };

    // Use provided store_id or fall back to environment variable
    const storeId = store_id || ctx.storeId;

    if (!storeId) {
      return {
        success: false,
        error: 'Store ID required. Either provide store_id parameter or set WILSON_STORE_ID environment variable.'
      };
    }

    // Validate items
    if (!Array.isArray(items) || items.length === 0) {
      return {
        success: false,
        error: 'No items provided. Transfer requires at least one product.'
      };
    }

    // Call atomic transfer function
    const { data, error } = await callRPC<{
      success: boolean;
      transfer_id?: string;
      transfer_number?: string;
      status?: string;
      items_count?: number;
      total_quantity?: number;
      error?: string;
    }>(ctx, 'transfer_inventory_atomic', {
      p_store_id: storeId,
      p_from_location_id: from_location_id,
      p_to_location_id: to_location_id,
      p_items: items,
      p_reason: reason,
      p_notes: notes || null,
      p_initiated_by: ctx.userId || null,
      p_auto_complete: auto_complete
    });

    if (error) {
      return {
        success: false,
        error: `Transfer failed: ${error}`
      };
    }

    // Check if RPC returned success
    if (!data?.success) {
      return {
        success: false,
        error: data?.error || 'Transfer operation failed'
      };
    }

    // Fetch location names and product details for formatted output
    const [fromLocationRes, toLocationRes] = await Promise.all([
      fetch(`${ctx.apiUrl}/rest/v1/locations?id=eq.${from_location_id}&select=name`, {
        headers: {
          'apikey': ctx.anonKey,
          'Authorization': `Bearer ${ctx.serviceKey || ctx.authToken || ctx.anonKey}`,
        }
      }),
      fetch(`${ctx.apiUrl}/rest/v1/locations?id=eq.${to_location_id}&select=name`, {
        headers: {
          'apikey': ctx.anonKey,
          'Authorization': `Bearer ${ctx.serviceKey || ctx.authToken || ctx.anonKey}`,
        }
      })
    ]);

    const fromLocations = await fromLocationRes.json();
    const toLocations = await toLocationRes.json();
    const fromLocationName = fromLocations[0]?.name || from_location_id;
    const toLocationName = toLocations[0]?.name || to_location_id;

    // Fetch product names
    const productIds = items.map(i => i.product_id).join(',');
    const productsRes = await fetch(
      `${ctx.apiUrl}/rest/v1/products?id=in.(${productIds})&select=id,name`,
      {
        headers: {
          'apikey': ctx.anonKey,
          'Authorization': `Bearer ${ctx.serviceKey || ctx.authToken || ctx.anonKey}`,
        }
      }
    );
    const products = await productsRes.json();
    const productMap = new Map(products.map((p: any) => [p.id, p.name]));

    // Build formatted items
    const formattedItems = items.map(item => ({
      product_name: productMap.get(item.product_id) || item.product_id,
      quantity: item.quantity,
      unit: item.unit || 'g'
    }));

    // Import and use formatter
    const { formatTransfer } = await import('../theme/inventory-formatter.js');
    const formattedOutput = formatTransfer({
      transfer_number: data.transfer_number || data.transfer_id || 'UNKNOWN',
      status: data.status || 'completed',
      from_location: fromLocationName,
      to_location: toLocationName,
      items: formattedItems,
      total_quantity: data.total_quantity || items.reduce((sum, item) => sum + item.quantity, 0),
      notes: notes
    });

    // SUCCESS - Return beautiful formatted result
    const itemsCount = data.items_count || items.length;
    const totalQty = data.total_quantity || items.reduce((sum, item) => sum + item.quantity, 0);

    return {
      success: true,
      content: `${formattedOutput}\n\n✅ TRANSFER COMPLETE. Task finished. Do not transfer additional products unless explicitly requested.`,
      summary: `✅ Transfer ${data.transfer_number}: ${itemsCount} products (${totalQty}${items[0]?.unit || 'g'}) ${fromLocationName} → ${toLocationName} - COMPLETE`,
      data: {
        transfer_id: data.transfer_id,
        transfer_number: data.transfer_number,
        status: data.status,
        items_count: itemsCount,
        total_quantity: totalQty,
        from_location: fromLocationName,
        to_location: toLocationName,
        items: formattedItems
      }
    };
  }
};

// =============================================================================
// Export for Tool Registry
// =============================================================================

export const transferTools: Record<string, Tool> = {
  TransferInventory: transferInventoryTool
};

export const transferSchemas: ToolSchema[] = [
  TransferInventorySchema
];
