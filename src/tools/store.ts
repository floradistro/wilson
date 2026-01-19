import type { Tool, ToolResult, ToolSchema } from '../types.js';
import { readFileSync, existsSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';

// =============================================================================
// Store Configuration Tools
// Comprehensive tools for managing catalogs, categories, pricing, and settings
// =============================================================================

interface StoreContext {
  apiUrl: string;
  anonKey: string;
  serviceKey?: string;
  authToken?: string;
  storeId?: string;
}

/**
 * Load authentication context from environment and auth file
 */
function loadStoreContext(): StoreContext | null {
  const apiUrl = process.env.WILSON_API_URL;
  const anonKey = process.env.WILSON_ANON_KEY;
  const serviceKey = process.env.WILSON_SERVICE_KEY;
  const storeId = process.env.WILSON_STORE_ID;

  if (!apiUrl || !anonKey) {
    return null;
  }

  let authToken: string | undefined;
  try {
    const authPath = join(homedir(), '.wilson', 'auth.json');
    if (existsSync(authPath)) {
      const auth = JSON.parse(readFileSync(authPath, 'utf-8'));
      authToken = auth.accessToken;
    }
  } catch {
    // Ignore
  }

  return { apiUrl, anonKey, serviceKey, authToken, storeId };
}

/**
 * Make authenticated request to Supabase
 */
async function supabaseRequest<T = unknown>(
  ctx: StoreContext,
  path: string,
  options: {
    method?: string;
    body?: unknown;
    params?: Record<string, string>;
  } = {}
): Promise<{ data: T | null; error: string | null; count?: number }> {
  const { method = 'GET', body, params = {} } = options;
  const bearerToken = ctx.serviceKey || ctx.authToken || ctx.anonKey;

  const url = new URL(`${ctx.apiUrl}/rest/v1/${path}`);
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }

  const headers: Record<string, string> = {
    'apikey': ctx.anonKey,
    'Authorization': `Bearer ${bearerToken}`,
    'Content-Type': 'application/json',
    'Prefer': method === 'POST' ? 'return=representation' : 'return=minimal',
  };

  // Get count for SELECT queries
  if (method === 'GET') {
    headers['Prefer'] = 'count=exact';
  }

  try {
    const response = await fetch(url.toString(), {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });

    const contentRange = response.headers.get('content-range');
    const count = contentRange ? parseInt(contentRange.split('/')[1]) : undefined;

    if (!response.ok) {
      const error = await response.json();
      return { data: null, error: error.message || JSON.stringify(error), count };
    }

    // Handle empty responses
    const text = await response.text();
    if (!text) {
      return { data: null, error: null, count };
    }

    return { data: JSON.parse(text) as T, error: null, count };
  } catch (error) {
    return { data: null, error: error instanceof Error ? error.message : 'Request failed' };
  }
}

// =============================================================================
// Product Tools
// =============================================================================

export const ProductListSchema: ToolSchema = {
  name: 'ProductList',
  description: 'List products with filtering, sorting, and pagination. Use for inventory views and product searches.',
  parameters: {
    type: 'object',
    properties: {
      category: { type: 'string', description: 'Filter by category name' },
      status: { type: 'string', enum: ['published', 'draft', 'archived'], description: 'Filter by status' },
      search: { type: 'string', description: 'Search in name, SKU, or description' },
      low_stock: { type: 'boolean', description: 'Show only low stock items' },
      limit: { type: 'number', description: 'Max results (default: 50)' },
      offset: { type: 'number', description: 'Pagination offset' },
      order: { type: 'string', description: 'Sort field (name, price, stock_quantity, created_at)' },
    },
    required: [],
  },
};

export const productListTool: Tool = {
  schema: ProductListSchema,
  async execute(params: Record<string, unknown>): Promise<ToolResult> {
    const ctx = loadStoreContext();
    if (!ctx) return { success: false, error: 'Missing Supabase config. Set WILSON_API_URL and WILSON_ANON_KEY.' };

    const { category, status, search, low_stock, limit = 50, offset = 0, order = 'name' } = params as {
      category?: string; status?: string; search?: string; low_stock?: boolean;
      limit?: number; offset?: number; order?: string;
    };

    const queryParams: Record<string, string> = {
      select: 'id,name,sku,regular_price,stock_quantity,status,primary_category_id,featured_image,low_stock_amount',
      limit: String(limit),
      offset: String(offset),
      order: `${order}.asc`,
    };

    if (ctx.storeId) queryParams.store_id = `eq.${ctx.storeId}`;
    if (category) queryParams.primary_category_id = `eq.${category}`;  // Changed from category_name to primary_category_id
    if (status) queryParams.status = `eq.${status}`;
    if (search) queryParams.or = `(name.ilike.*${search}*,sku.ilike.*${search}*)`;
    if (low_stock) queryParams.stock_quantity = `lt.low_stock_amount`;

    const { data, error, count } = await supabaseRequest<unknown[]>(ctx, 'products', { params: queryParams });

    if (error) return { success: false, error };

    const products = data || [];
    return {
      success: true,
      content: JSON.stringify(products, null, 2),
      summary: `${products.length} products${count ? ` (${count} total)` : ''}`,
      data: { type: 'table', headers: ['Name', 'SKU', 'Price', 'Stock', 'Status'], rows: products.map((p: any) => [p.name, p.sku, `$${p.regular_price}`, p.stock_quantity, p.status]) },
    };
  },
};

export const ProductCreateSchema: ToolSchema = {
  name: 'ProductCreate',
  description: 'Create a new product in the catalog.',
  parameters: {
    type: 'object',
    properties: {
      name: { type: 'string', description: 'Product name' },
      sku: { type: 'string', description: 'Stock Keeping Unit (unique)' },
      regular_price: { type: 'number', description: 'Regular price' },
      description: { type: 'string', description: 'Product description' },
      category_name: { type: 'string', description: 'Category name' },
      stock_quantity: { type: 'number', description: 'Initial stock quantity' },
      low_stock_threshold: { type: 'number', description: 'Low stock alert threshold (default: 10)' },
      status: { type: 'string', enum: ['published', 'draft'], description: 'Product status (default: draft)' },
      featured_image: { type: 'string', description: 'Image URL' },
      custom_fields: { type: 'object', description: 'Custom fields as key-value pairs' },
    },
    required: ['name', 'sku', 'regular_price'],
  },
};

export const productCreateTool: Tool = {
  schema: ProductCreateSchema,
  async execute(params: Record<string, unknown>): Promise<ToolResult> {
    const ctx = loadStoreContext();
    if (!ctx) return { success: false, error: 'Missing Supabase config.' };

    const product = {
      ...params,
      store_id: ctx.storeId,
      status: params.status || 'draft',
      low_stock_threshold: params.low_stock_threshold || 10,
      stock_quantity: params.stock_quantity || 0,
    };

    const { data, error } = await supabaseRequest<unknown[]>(ctx, 'products', {
      method: 'POST',
      body: product,
    });

    if (error) return { success: false, error };

    return {
      success: true,
      content: JSON.stringify(data?.[0], null, 2),
      summary: `Created product: ${params.name}`,
    };
  },
};

export const ProductUpdateSchema: ToolSchema = {
  name: 'ProductUpdate',
  description: 'Update an existing product. Provide product ID and fields to update.',
  parameters: {
    type: 'object',
    properties: {
      id: { type: 'string', description: 'Product ID (UUID)' },
      name: { type: 'string', description: 'Product name' },
      sku: { type: 'string', description: 'SKU' },
      regular_price: { type: 'number', description: 'Regular price' },
      sale_price: { type: 'number', description: 'Sale price' },
      description: { type: 'string', description: 'Description' },
      category_name: { type: 'string', description: 'Category' },
      stock_quantity: { type: 'number', description: 'Stock quantity' },
      status: { type: 'string', enum: ['published', 'draft', 'archived'], description: 'Status' },
      custom_fields: { type: 'object', description: 'Custom fields' },
    },
    required: ['id'],
  },
};

export const productUpdateTool: Tool = {
  schema: ProductUpdateSchema,
  async execute(params: Record<string, unknown>): Promise<ToolResult> {
    const ctx = loadStoreContext();
    if (!ctx) return { success: false, error: 'Missing Supabase config.' };

    const { id, ...updates } = params;

    const { data, error } = await supabaseRequest<unknown[]>(ctx, 'products', {
      method: 'PATCH',
      body: updates,
      params: { id: `eq.${id}` },
    });

    if (error) return { success: false, error };

    return {
      success: true,
      content: JSON.stringify(data?.[0], null, 2),
      summary: `Updated product ${id}`,
    };
  },
};

export const ProductBulkUpdateSchema: ToolSchema = {
  name: 'ProductBulkUpdate',
  description: 'Bulk update multiple products. Apply same changes to products matching filter.',
  parameters: {
    type: 'object',
    properties: {
      filter: { type: 'object', description: 'Filter criteria', properties: {
        category_name: { type: 'string' },
        status: { type: 'string' },
        ids: { type: 'array', items: { type: 'string' } },
      }},
      updates: { type: 'object', description: 'Fields to update', properties: {
        status: { type: 'string' },
        category_name: { type: 'string' },
        price_adjustment: { type: 'number', description: 'Percentage to adjust prices (+10 or -10)' },
      }},
    },
    required: ['filter', 'updates'],
  },
};

export const productBulkUpdateTool: Tool = {
  schema: ProductBulkUpdateSchema,
  async execute(params: Record<string, unknown>): Promise<ToolResult> {
    const ctx = loadStoreContext();
    if (!ctx) return { success: false, error: 'Missing Supabase config.' };

    const { filter, updates } = params as {
      filter: { category_name?: string; status?: string; ids?: string[] };
      updates: { status?: string; category_name?: string; price_adjustment?: number };
    };

    const queryParams: Record<string, string> = {};
    if (ctx.storeId) queryParams.store_id = `eq.${ctx.storeId}`;
    if (filter.category_name) queryParams.category_name = `eq.${filter.category_name}`;
    if (filter.status) queryParams.status = `eq.${filter.status}`;
    if (filter.ids?.length) queryParams.id = `in.(${filter.ids.join(',')})`;

    // Handle price adjustment separately (requires getting current prices)
    const bodyUpdates: Record<string, unknown> = { ...updates };
    delete bodyUpdates.price_adjustment;

    const { error } = await supabaseRequest(ctx, 'products', {
      method: 'PATCH',
      body: bodyUpdates,
      params: queryParams,
    });

    if (error) return { success: false, error };

    return {
      success: true,
      summary: `Bulk updated products matching filter`,
    };
  },
};

// =============================================================================
// Category Tools
// =============================================================================

export const CategoryListSchema: ToolSchema = {
  name: 'CategoryList',
  description: 'List all product categories with product counts.',
  parameters: {
    type: 'object',
    properties: {
      parent_id: { type: 'string', description: 'Filter by parent category (for hierarchy)' },
      include_counts: { type: 'boolean', description: 'Include product counts (default: true)' },
    },
    required: [],
  },
};

export const categoryListTool: Tool = {
  schema: CategoryListSchema,
  async execute(params: Record<string, unknown>): Promise<ToolResult> {
    const ctx = loadStoreContext();
    if (!ctx) return { success: false, error: 'Missing Supabase config.' };

    const queryParams: Record<string, string> = {
      select: 'id,name,slug,description,parent_id,sort_order,is_active',
      order: 'sort_order.asc,name.asc',
    };

    if (ctx.storeId) queryParams.store_id = `eq.${ctx.storeId}`;
    if (params.parent_id) queryParams.parent_id = `eq.${params.parent_id}`;

    const { data, error } = await supabaseRequest<unknown[]>(ctx, 'categories', { params: queryParams });

    if (error) return { success: false, error };

    return {
      success: true,
      content: JSON.stringify(data, null, 2),
      summary: `${(data || []).length} categories`,
    };
  },
};

export const CategoryCreateSchema: ToolSchema = {
  name: 'CategoryCreate',
  description: 'Create a new product category.',
  parameters: {
    type: 'object',
    properties: {
      name: { type: 'string', description: 'Category name' },
      slug: { type: 'string', description: 'URL slug (auto-generated if not provided)' },
      description: { type: 'string', description: 'Category description' },
      parent_id: { type: 'string', description: 'Parent category ID for hierarchy' },
      sort_order: { type: 'number', description: 'Display order (default: 0)' },
      image_url: { type: 'string', description: 'Category image URL' },
    },
    required: ['name'],
  },
};

export const categoryCreateTool: Tool = {
  schema: CategoryCreateSchema,
  async execute(params: Record<string, unknown>): Promise<ToolResult> {
    const ctx = loadStoreContext();
    if (!ctx) return { success: false, error: 'Missing Supabase config.' };

    const name = params.name as string;
    const category = {
      ...params,
      store_id: ctx.storeId,
      slug: params.slug || name.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, ''),
      is_active: true,
    };

    const { data, error } = await supabaseRequest<unknown[]>(ctx, 'categories', {
      method: 'POST',
      body: category,
    });

    if (error) return { success: false, error };

    return {
      success: true,
      content: JSON.stringify(data?.[0], null, 2),
      summary: `Created category: ${name}`,
    };
  },
};

export const CategoryUpdateSchema: ToolSchema = {
  name: 'CategoryUpdate',
  description: 'Update an existing category.',
  parameters: {
    type: 'object',
    properties: {
      id: { type: 'string', description: 'Category ID' },
      name: { type: 'string', description: 'Category name' },
      description: { type: 'string', description: 'Description' },
      parent_id: { type: 'string', description: 'Parent category ID' },
      sort_order: { type: 'number', description: 'Display order' },
      is_active: { type: 'boolean', description: 'Is category active' },
    },
    required: ['id'],
  },
};

export const categoryUpdateTool: Tool = {
  schema: CategoryUpdateSchema,
  async execute(params: Record<string, unknown>): Promise<ToolResult> {
    const ctx = loadStoreContext();
    if (!ctx) return { success: false, error: 'Missing Supabase config.' };

    const { id, ...updates } = params;

    const { error } = await supabaseRequest(ctx, 'categories', {
      method: 'PATCH',
      body: updates,
      params: { id: `eq.${id}` },
    });

    if (error) return { success: false, error };

    return { success: true, summary: `Updated category ${id}` };
  },
};

// =============================================================================
// Field Group Tools (Custom Fields)
// =============================================================================

export const FieldGroupListSchema: ToolSchema = {
  name: 'FieldGroupList',
  description: 'List custom field groups defined for products.',
  parameters: {
    type: 'object',
    properties: {
      category_id: { type: 'string', description: 'Filter by category' },
    },
    required: [],
  },
};

export const fieldGroupListTool: Tool = {
  schema: FieldGroupListSchema,
  async execute(params: Record<string, unknown>): Promise<ToolResult> {
    const ctx = loadStoreContext();
    if (!ctx) return { success: false, error: 'Missing Supabase config.' };

    const queryParams: Record<string, string> = {
      select: 'id,name,description,fields,category_ids,is_active,sort_order',
      order: 'sort_order.asc',
    };

    if (ctx.storeId) queryParams.store_id = `eq.${ctx.storeId}`;

    const { data, error } = await supabaseRequest<unknown[]>(ctx, 'field_groups', { params: queryParams });

    if (error) return { success: false, error };

    return {
      success: true,
      content: JSON.stringify(data, null, 2),
      summary: `${(data || []).length} field groups`,
    };
  },
};

export const FieldGroupCreateSchema: ToolSchema = {
  name: 'FieldGroupCreate',
  description: 'Create a custom field group for products. Define reusable field templates.',
  parameters: {
    type: 'object',
    properties: {
      name: { type: 'string', description: 'Field group name (e.g., "Cannabis Info")' },
      description: { type: 'string', description: 'Description' },
      fields: {
        type: 'array',
        description: 'Array of field definitions',
        items: {
          type: 'object',
          properties: {
            key: { type: 'string', description: 'Field key (snake_case)' },
            label: { type: 'string', description: 'Display label' },
            type: { type: 'string', enum: ['text', 'number', 'select', 'multiselect', 'boolean', 'date', 'url'], description: 'Field type' },
            required: { type: 'boolean', description: 'Is field required' },
            options: { type: 'array', items: { type: 'string' }, description: 'Options for select/multiselect' },
            default_value: { type: 'string', description: 'Default value' },
          },
          required: ['key', 'label', 'type'],
        },
      },
      category_ids: { type: 'array', items: { type: 'string' }, description: 'Categories this applies to (empty = all)' },
    },
    required: ['name', 'fields'],
  },
};

export const fieldGroupCreateTool: Tool = {
  schema: FieldGroupCreateSchema,
  async execute(params: Record<string, unknown>): Promise<ToolResult> {
    const ctx = loadStoreContext();
    if (!ctx) return { success: false, error: 'Missing Supabase config.' };

    const fieldGroup = {
      ...params,
      store_id: ctx.storeId,
      is_active: true,
    };

    const { data, error } = await supabaseRequest<unknown[]>(ctx, 'field_groups', {
      method: 'POST',
      body: fieldGroup,
    });

    if (error) return { success: false, error };

    return {
      success: true,
      content: JSON.stringify(data?.[0], null, 2),
      summary: `Created field group: ${params.name}`,
    };
  },
};

// =============================================================================
// Pricing Template Tools
// =============================================================================

export const PricingTemplateListSchema: ToolSchema = {
  name: 'PricingTemplateList',
  description: 'List pricing templates and rules.',
  parameters: {
    type: 'object',
    properties: {
      is_active: { type: 'boolean', description: 'Filter by active status' },
    },
    required: [],
  },
};

export const pricingTemplateListTool: Tool = {
  schema: PricingTemplateListSchema,
  async execute(params: Record<string, unknown>): Promise<ToolResult> {
    const ctx = loadStoreContext();
    if (!ctx) return { success: false, error: 'Missing Supabase config.' };

    const queryParams: Record<string, string> = {
      select: 'id,name,description,type,rules,priority,is_active,starts_at,ends_at',
      order: 'priority.desc',
    };

    if (ctx.storeId) queryParams.store_id = `eq.${ctx.storeId}`;
    if (params.is_active !== undefined) queryParams.is_active = `eq.${params.is_active}`;

    const { data, error } = await supabaseRequest<unknown[]>(ctx, 'pricing_templates', { params: queryParams });

    if (error) return { success: false, error };

    return {
      success: true,
      content: JSON.stringify(data, null, 2),
      summary: `${(data || []).length} pricing templates`,
    };
  },
};

export const PricingTemplateCreateSchema: ToolSchema = {
  name: 'PricingTemplateCreate',
  description: 'Create a pricing template for automatic discounts, markups, or tiered pricing.',
  parameters: {
    type: 'object',
    properties: {
      name: { type: 'string', description: 'Template name' },
      description: { type: 'string', description: 'Description' },
      type: { type: 'string', enum: ['discount', 'markup', 'tiered', 'bundle', 'bogo'], description: 'Pricing type' },
      rules: {
        type: 'object',
        description: 'Pricing rules',
        properties: {
          percentage: { type: 'number', description: 'Discount/markup percentage' },
          fixed_amount: { type: 'number', description: 'Fixed discount/markup amount' },
          min_quantity: { type: 'number', description: 'Minimum quantity for rule' },
          tiers: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                min_qty: { type: 'number' },
                max_qty: { type: 'number' },
                percentage: { type: 'number' },
              },
            },
          },
          applies_to: {
            type: 'object',
            properties: {
              categories: { type: 'array', items: { type: 'string' } },
              products: { type: 'array', items: { type: 'string' } },
              all: { type: 'boolean' },
            },
          },
        },
      },
      priority: { type: 'number', description: 'Priority (higher = evaluated first, default: 0)' },
      starts_at: { type: 'string', description: 'Start date (ISO 8601)' },
      ends_at: { type: 'string', description: 'End date (ISO 8601)' },
    },
    required: ['name', 'type', 'rules'],
  },
};

export const pricingTemplateCreateTool: Tool = {
  schema: PricingTemplateCreateSchema,
  async execute(params: Record<string, unknown>): Promise<ToolResult> {
    const ctx = loadStoreContext();
    if (!ctx) return { success: false, error: 'Missing Supabase config.' };

    const template = {
      ...params,
      store_id: ctx.storeId,
      is_active: true,
      priority: params.priority || 0,
    };

    const { data, error } = await supabaseRequest<unknown[]>(ctx, 'pricing_templates', {
      method: 'POST',
      body: template,
    });

    if (error) return { success: false, error };

    return {
      success: true,
      content: JSON.stringify(data?.[0], null, 2),
      summary: `Created pricing template: ${params.name}`,
    };
  },
};

// =============================================================================
// Tax & Shipping Tools
// =============================================================================

export const TaxRateListSchema: ToolSchema = {
  name: 'TaxRateList',
  description: 'List configured tax rates by state/region.',
  parameters: {
    type: 'object',
    properties: {
      country: { type: 'string', description: 'Filter by country (default: US)' },
    },
    required: [],
  },
};

export const taxRateListTool: Tool = {
  schema: TaxRateListSchema,
  async execute(params: Record<string, unknown>): Promise<ToolResult> {
    const ctx = loadStoreContext();
    if (!ctx) return { success: false, error: 'Missing Supabase config.' };

    const queryParams: Record<string, string> = {
      select: 'id,name,state,country,rate,is_active',
      order: 'state.asc',
    };

    if (ctx.storeId) queryParams.store_id = `eq.${ctx.storeId}`;
    if (params.country) queryParams.country = `eq.${params.country}`;

    const { data, error } = await supabaseRequest<unknown[]>(ctx, 'tax_rates', { params: queryParams });

    if (error) return { success: false, error };

    return {
      success: true,
      content: JSON.stringify(data, null, 2),
      summary: `${(data || []).length} tax rates configured`,
    };
  },
};

export const TaxRateSetSchema: ToolSchema = {
  name: 'TaxRateSet',
  description: 'Create or update a tax rate for a state/region.',
  parameters: {
    type: 'object',
    properties: {
      state: { type: 'string', description: 'State/province code (e.g., CA, NY)' },
      country: { type: 'string', description: 'Country code (default: US)' },
      rate: { type: 'number', description: 'Tax rate as decimal (e.g., 0.0825 for 8.25%)' },
      name: { type: 'string', description: 'Tax name (e.g., "California Sales Tax")' },
      is_active: { type: 'boolean', description: 'Is tax active (default: true)' },
    },
    required: ['state', 'rate'],
  },
};

export const taxRateSetTool: Tool = {
  schema: TaxRateSetSchema,
  async execute(params: Record<string, unknown>): Promise<ToolResult> {
    const ctx = loadStoreContext();
    if (!ctx) return { success: false, error: 'Missing Supabase config.' };

    const { state, country = 'US', rate, name, is_active = true } = params as {
      state: string; country?: string; rate: number; name?: string; is_active?: boolean;
    };

    const taxRate = {
      store_id: ctx.storeId,
      state,
      country,
      rate,
      name: name || `${state} Sales Tax`,
      is_active,
    };

    // Upsert by store_id + state + country
    const { data, error } = await supabaseRequest<unknown[]>(ctx, 'tax_rates', {
      method: 'POST',
      body: taxRate,
      params: { on_conflict: 'store_id,state,country' },
    });

    if (error) return { success: false, error };

    return {
      success: true,
      content: JSON.stringify(data?.[0], null, 2),
      summary: `Set tax rate for ${state}: ${(rate * 100).toFixed(2)}%`,
    };
  },
};

export const ShippingMethodListSchema: ToolSchema = {
  name: 'ShippingMethodList',
  description: 'List configured shipping methods.',
  parameters: {
    type: 'object',
    properties: {},
    required: [],
  },
};

export const shippingMethodListTool: Tool = {
  schema: ShippingMethodListSchema,
  async execute(): Promise<ToolResult> {
    const ctx = loadStoreContext();
    if (!ctx) return { success: false, error: 'Missing Supabase config.' };

    const queryParams: Record<string, string> = {
      select: 'id,name,description,price,estimated_days,carrier,is_active,sort_order',
      order: 'sort_order.asc',
    };

    if (ctx.storeId) queryParams.store_id = `eq.${ctx.storeId}`;

    const { data, error } = await supabaseRequest<unknown[]>(ctx, 'shipping_methods', { params: queryParams });

    if (error) return { success: false, error };

    return {
      success: true,
      content: JSON.stringify(data, null, 2),
      summary: `${(data || []).length} shipping methods`,
    };
  },
};

export const ShippingMethodCreateSchema: ToolSchema = {
  name: 'ShippingMethodCreate',
  description: 'Create a new shipping method.',
  parameters: {
    type: 'object',
    properties: {
      name: { type: 'string', description: 'Shipping method name' },
      description: { type: 'string', description: 'Description' },
      price: { type: 'number', description: 'Shipping price' },
      estimated_days: { type: 'string', description: 'Estimated delivery (e.g., "3-5 business days")' },
      carrier: { type: 'string', description: 'Carrier (UPS, USPS, FedEx, etc.)' },
      min_order_amount: { type: 'number', description: 'Minimum order for free shipping' },
      zones: { type: 'array', items: { type: 'string' }, description: 'State/country codes this applies to' },
    },
    required: ['name', 'price'],
  },
};

export const shippingMethodCreateTool: Tool = {
  schema: ShippingMethodCreateSchema,
  async execute(params: Record<string, unknown>): Promise<ToolResult> {
    const ctx = loadStoreContext();
    if (!ctx) return { success: false, error: 'Missing Supabase config.' };

    const method = {
      ...params,
      store_id: ctx.storeId,
      is_active: true,
    };

    const { data, error } = await supabaseRequest<unknown[]>(ctx, 'shipping_methods', {
      method: 'POST',
      body: method,
    });

    if (error) return { success: false, error };

    return {
      success: true,
      content: JSON.stringify(data?.[0], null, 2),
      summary: `Created shipping method: ${params.name}`,
    };
  },
};

// =============================================================================
// Location & POS Tools
// =============================================================================

export const LocationListSchema: ToolSchema = {
  name: 'LocationList',
  description: 'List store locations.',
  parameters: {
    type: 'object',
    properties: {
      is_active: { type: 'boolean', description: 'Filter by active status' },
    },
    required: [],
  },
};

export const locationListTool: Tool = {
  schema: LocationListSchema,
  async execute(params: Record<string, unknown>): Promise<ToolResult> {
    const ctx = loadStoreContext();
    if (!ctx) return { success: false, error: 'Missing Supabase config.' };

    const queryParams: Record<string, string> = {
      select: 'id,name,slug,address_line1,address_line2,city,state,zip,phone,is_active,is_default,accepts_online_orders',
      order: 'name.asc',
    };

    if (ctx.storeId) queryParams.store_id = `eq.${ctx.storeId}`;
    if (params.is_active !== undefined) queryParams.is_active = `eq.${params.is_active}`;

    const { data, error } = await supabaseRequest<unknown[]>(ctx, 'locations', { params: queryParams });

    if (error) return { success: false, error };

    return {
      success: true,
      content: JSON.stringify(data, null, 2),
      summary: `${(data || []).length} locations`,
    };
  },
};

export const LocationCreateSchema: ToolSchema = {
  name: 'LocationCreate',
  description: 'Create a new store location.',
  parameters: {
    type: 'object',
    properties: {
      name: { type: 'string', description: 'Location name' },
      address_line1: { type: 'string', description: 'Street address line 1' },
      address_line2: { type: 'string', description: 'Street address line 2 (optional)' },
      city: { type: 'string', description: 'City' },
      state: { type: 'string', description: 'State code' },
      zip: { type: 'string', description: 'ZIP code' },
      phone: { type: 'string', description: 'Phone number' },
      is_default: { type: 'boolean', description: 'Set as default location' },
      accepts_online_orders: { type: 'boolean', description: 'Accepts online orders (default: true)' },
    },
    required: ['name', 'address_line1', 'city', 'state', 'zip'],
  },
};

export const locationCreateTool: Tool = {
  schema: LocationCreateSchema,
  async execute(params: Record<string, unknown>): Promise<ToolResult> {
    const ctx = loadStoreContext();
    if (!ctx) return { success: false, error: 'Missing Supabase config.' };

    const name = params.name as string;
    const location = {
      ...params,
      store_id: ctx.storeId,
      slug: name.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, ''),
      is_active: true,
      accepts_online_orders: params.accepts_online_orders ?? true,
    };

    const { data, error } = await supabaseRequest<unknown[]>(ctx, 'locations', {
      method: 'POST',
      body: location,
    });

    if (error) return { success: false, error };

    return {
      success: true,
      content: JSON.stringify(data?.[0], null, 2),
      summary: `Created location: ${name}`,
    };
  },
};

export const RegisterListSchema: ToolSchema = {
  name: 'RegisterList',
  description: 'List POS registers for a location.',
  parameters: {
    type: 'object',
    properties: {
      location_id: { type: 'string', description: 'Filter by location ID' },
    },
    required: [],
  },
};

export const registerListTool: Tool = {
  schema: RegisterListSchema,
  async execute(params: Record<string, unknown>): Promise<ToolResult> {
    const ctx = loadStoreContext();
    if (!ctx) return { success: false, error: 'Missing Supabase config.' };

    const queryParams: Record<string, string> = {
      select: 'id,name,location_id,payment_processor_id,is_active,locations(name)',
      order: 'name.asc',
    };

    if (params.location_id) queryParams.location_id = `eq.${params.location_id}`;

    const { data, error } = await supabaseRequest<unknown[]>(ctx, 'registers', { params: queryParams });

    if (error) return { success: false, error };

    return {
      success: true,
      content: JSON.stringify(data, null, 2),
      summary: `${(data || []).length} registers`,
    };
  },
};

export const RegisterCreateSchema: ToolSchema = {
  name: 'RegisterCreate',
  description: 'Create a new POS register.',
  parameters: {
    type: 'object',
    properties: {
      name: { type: 'string', description: 'Register name (e.g., "Register 1")' },
      location_id: { type: 'string', description: 'Location ID' },
      payment_processor_id: { type: 'string', description: 'Payment processor ID' },
    },
    required: ['name', 'location_id'],
  },
};

export const registerCreateTool: Tool = {
  schema: RegisterCreateSchema,
  async execute(params: Record<string, unknown>): Promise<ToolResult> {
    const ctx = loadStoreContext();
    if (!ctx) return { success: false, error: 'Missing Supabase config.' };

    const register = {
      ...params,
      is_active: true,
    };

    const { data, error } = await supabaseRequest<unknown[]>(ctx, 'registers', {
      method: 'POST',
      body: register,
    });

    if (error) return { success: false, error };

    return {
      success: true,
      content: JSON.stringify(data?.[0], null, 2),
      summary: `Created register: ${params.name}`,
    };
  },
};

// =============================================================================
// Payment Processor Tools
// =============================================================================

export const PaymentProcessorListSchema: ToolSchema = {
  name: 'PaymentProcessorList',
  description: 'List configured payment processors.',
  parameters: {
    type: 'object',
    properties: {
      location_id: { type: 'string', description: 'Filter by location' },
    },
    required: [],
  },
};

export const paymentProcessorListTool: Tool = {
  schema: PaymentProcessorListSchema,
  async execute(params: Record<string, unknown>): Promise<ToolResult> {
    const ctx = loadStoreContext();
    if (!ctx) return { success: false, error: 'Missing Supabase config.' };

    const queryParams: Record<string, string> = {
      select: 'id,processor_type,processor_name,location_id,is_active,is_default,environment',
      order: 'processor_name.asc',
    };

    if (params.location_id) queryParams.location_id = `eq.${params.location_id}`;

    const { data, error } = await supabaseRequest<unknown[]>(ctx, 'payment_processors', { params: queryParams });

    if (error) return { success: false, error };

    return {
      success: true,
      content: JSON.stringify(data, null, 2),
      summary: `${(data || []).length} payment processors`,
    };
  },
};

export const PaymentProcessorCreateSchema: ToolSchema = {
  name: 'PaymentProcessorCreate',
  description: 'Configure a payment processor for a location.',
  parameters: {
    type: 'object',
    properties: {
      processor_type: { type: 'string', enum: ['dejavoo', 'authorizenet', 'stripe', 'square'], description: 'Processor type' },
      processor_name: { type: 'string', description: 'Display name' },
      location_id: { type: 'string', description: 'Location ID' },
      environment: { type: 'string', enum: ['sandbox', 'production'], description: 'Environment (default: sandbox)' },
      is_default: { type: 'boolean', description: 'Set as default processor' },
      config: { type: 'object', description: 'Processor-specific config (API keys, etc.)' },
    },
    required: ['processor_type', 'processor_name', 'location_id'],
  },
};

export const paymentProcessorCreateTool: Tool = {
  schema: PaymentProcessorCreateSchema,
  async execute(params: Record<string, unknown>): Promise<ToolResult> {
    const ctx = loadStoreContext();
    if (!ctx) return { success: false, error: 'Missing Supabase config.' };

    const { config, ...rest } = params as Record<string, unknown>;
    const processor = {
      ...rest,
      ...config, // Spread config fields directly
      is_active: true,
      environment: params.environment || 'sandbox',
    };

    const { data, error } = await supabaseRequest<unknown[]>(ctx, 'payment_processors', {
      method: 'POST',
      body: processor,
    });

    if (error) return { success: false, error };

    return {
      success: true,
      content: JSON.stringify(data?.[0], null, 2),
      summary: `Created payment processor: ${params.processor_name}`,
    };
  },
};

// =============================================================================
// Store Config Tools
// =============================================================================

export const StoreConfigGetSchema: ToolSchema = {
  name: 'StoreConfigGet',
  description: 'Get current store configuration and settings.',
  parameters: {
    type: 'object',
    properties: {},
    required: [],
  },
};

export const storeConfigGetTool: Tool = {
  schema: StoreConfigGetSchema,
  async execute(): Promise<ToolResult> {
    const ctx = loadStoreContext();
    if (!ctx) return { success: false, error: 'Missing Supabase config.' };
    if (!ctx.storeId) return { success: false, error: 'WILSON_STORE_ID not set.' };

    const queryParams: Record<string, string> = {
      select: 'id,store_id,config,wilson_context,features',
      store_id: `eq.${ctx.storeId}`,
    };

    const { data, error } = await supabaseRequest<unknown[]>(ctx, 'store_config', { params: queryParams });

    if (error) return { success: false, error };

    const config = data?.[0];
    return {
      success: true,
      content: JSON.stringify(config, null, 2),
      summary: config ? 'Store configuration loaded' : 'No configuration found',
    };
  },
};

export const StoreConfigSetSchema: ToolSchema = {
  name: 'StoreConfigSet',
  description: 'Update store configuration settings.',
  parameters: {
    type: 'object',
    properties: {
      config: {
        type: 'object',
        description: 'Configuration settings to update',
        properties: {
          timezone: { type: 'string', description: 'Store timezone' },
          currency: { type: 'string', description: 'Currency code (USD, EUR, etc.)' },
          business_hours: { type: 'object', description: 'Business hours by day' },
          notifications: { type: 'object', description: 'Notification preferences' },
        },
      },
      features: {
        type: 'object',
        description: 'Feature flags',
        properties: {
          wilson_enabled: { type: 'boolean' },
          offline_mode: { type: 'boolean' },
          auto_prefetch: { type: 'boolean' },
        },
      },
    },
    required: [],
  },
};

export const storeConfigSetTool: Tool = {
  schema: StoreConfigSetSchema,
  async execute(params: Record<string, unknown>): Promise<ToolResult> {
    const ctx = loadStoreContext();
    if (!ctx) return { success: false, error: 'Missing Supabase config.' };
    if (!ctx.storeId) return { success: false, error: 'WILSON_STORE_ID not set.' };

    const updates: Record<string, unknown> = {};
    if (params.config) updates.config = params.config;
    if (params.features) updates.features = params.features;

    const { error } = await supabaseRequest(ctx, 'store_config', {
      method: 'PATCH',
      body: updates,
      params: { store_id: `eq.${ctx.storeId}` },
    });

    if (error) return { success: false, error };

    return { success: true, summary: 'Store configuration updated' };
  },
};

// =============================================================================
// Inventory Tools
// =============================================================================

export const InventoryAdjustSchema: ToolSchema = {
  name: 'InventoryAdjust',
  description: 'Adjust inventory for a product. Use positive numbers to add stock, negative to remove.',
  parameters: {
    type: 'object',
    properties: {
      product_id: { type: 'string', description: 'Product ID' },
      quantity: { type: 'number', description: 'Quantity to adjust (+/-)' },
      reason: { type: 'string', enum: ['restock', 'adjustment', 'damage', 'theft', 'return', 'transfer'], description: 'Reason for adjustment' },
      notes: { type: 'string', description: 'Additional notes' },
      location_id: { type: 'string', description: 'Location ID (optional)' },
    },
    required: ['product_id', 'quantity', 'reason'],
  },
};

export const inventoryAdjustTool: Tool = {
  schema: InventoryAdjustSchema,
  async execute(params: Record<string, unknown>): Promise<ToolResult> {
    const ctx = loadStoreContext();
    if (!ctx) return { success: false, error: 'Missing Supabase config.' };

    const { product_id, quantity, reason, notes, location_id } = params as {
      product_id: string; quantity: number; reason: string; notes?: string; location_id?: string;
    };

    // Call the RPC function to track inventory movement
    const { data, error } = await supabaseRequest<{ id: string }>(ctx, 'rpc/track_inventory_movement', {
      method: 'POST',
      body: {
        p_store_id: ctx.storeId,
        p_product_id: product_id,
        p_quantity: quantity,
        p_movement_type: reason,
        p_location_id: location_id || null,
        p_notes: notes || null,
      },
    });

    if (error) return { success: false, error };

    const action = quantity > 0 ? 'Added' : 'Removed';
    return {
      success: true,
      summary: `${action} ${Math.abs(quantity)} units (${reason})`,
    };
  },
};

export const InventoryLowStockSchema: ToolSchema = {
  name: 'InventoryLowStock',
  description: 'Get products with low stock levels.',
  parameters: {
    type: 'object',
    properties: {
      threshold: { type: 'number', description: 'Override threshold (uses product setting if not provided)' },
      category: { type: 'string', description: 'Filter by category' },
    },
    required: [],
  },
};

export const inventoryLowStockTool: Tool = {
  schema: InventoryLowStockSchema,
  async execute(params: Record<string, unknown>): Promise<ToolResult> {
    const ctx = loadStoreContext();
    if (!ctx) return { success: false, error: 'Missing Supabase config.' };

    const queryParams: Record<string, string> = {
      select: 'id,name,sku,stock_quantity,low_stock_threshold,category_name',
      order: 'stock_quantity.asc',
    };

    if (ctx.storeId) queryParams.store_id = `eq.${ctx.storeId}`;
    if (params.category) queryParams.category_name = `ilike.*${params.category}*`;

    // Filter for low stock - this is a special case where stock < threshold
    queryParams.or = '(stock_quantity.lt.low_stock_threshold,stock_quantity.eq.0)';

    const { data, error } = await supabaseRequest<unknown[]>(ctx, 'products', { params: queryParams });

    if (error) return { success: false, error };

    const products = data || [];
    return {
      success: true,
      content: JSON.stringify(products, null, 2),
      summary: `${products.length} products with low stock`,
      data: {
        type: 'table',
        headers: ['Product', 'SKU', 'Stock', 'Threshold'],
        rows: products.map((p: any) => [p.name, p.sku, p.stock_quantity, p.low_stock_threshold]),
      },
    };
  },
};

// =============================================================================
// Coupon Tools
// =============================================================================

export const CouponListSchema: ToolSchema = {
  name: 'CouponList',
  description: 'List discount coupons.',
  parameters: {
    type: 'object',
    properties: {
      is_active: { type: 'boolean', description: 'Filter by active status' },
      include_expired: { type: 'boolean', description: 'Include expired coupons' },
    },
    required: [],
  },
};

export const couponListTool: Tool = {
  schema: CouponListSchema,
  async execute(params: Record<string, unknown>): Promise<ToolResult> {
    const ctx = loadStoreContext();
    if (!ctx) return { success: false, error: 'Missing Supabase config.' };

    const queryParams: Record<string, string> = {
      select: 'id,code,description,discount_type,discount_value,min_order_amount,max_uses,current_uses,is_active,starts_at,ends_at',
      order: 'created_at.desc',
    };

    if (ctx.storeId) queryParams.store_id = `eq.${ctx.storeId}`;
    if (params.is_active !== undefined) queryParams.is_active = `eq.${params.is_active}`;

    const { data, error } = await supabaseRequest<unknown[]>(ctx, 'coupons', { params: queryParams });

    if (error) return { success: false, error };

    return {
      success: true,
      content: JSON.stringify(data, null, 2),
      summary: `${(data || []).length} coupons`,
    };
  },
};

export const CouponCreateSchema: ToolSchema = {
  name: 'CouponCreate',
  description: 'Create a new discount coupon.',
  parameters: {
    type: 'object',
    properties: {
      code: { type: 'string', description: 'Coupon code (uppercase recommended)' },
      description: { type: 'string', description: 'Description' },
      discount_type: { type: 'string', enum: ['percentage', 'fixed', 'free_shipping'], description: 'Discount type' },
      discount_value: { type: 'number', description: 'Discount value (percentage or fixed amount)' },
      min_order_amount: { type: 'number', description: 'Minimum order amount' },
      max_discount_amount: { type: 'number', description: 'Maximum discount cap (for percentage)' },
      max_uses: { type: 'number', description: 'Total uses allowed' },
      max_uses_per_customer: { type: 'number', description: 'Uses per customer (default: 1)' },
      starts_at: { type: 'string', description: 'Start date (ISO 8601)' },
      ends_at: { type: 'string', description: 'End date (ISO 8601)' },
    },
    required: ['code', 'discount_type', 'discount_value'],
  },
};

export const couponCreateTool: Tool = {
  schema: CouponCreateSchema,
  async execute(params: Record<string, unknown>): Promise<ToolResult> {
    const ctx = loadStoreContext();
    if (!ctx) return { success: false, error: 'Missing Supabase config.' };

    const code = (params.code as string).toUpperCase();
    const coupon = {
      ...params,
      code,
      store_id: ctx.storeId,
      is_active: true,
      current_uses: 0,
    };

    const { data, error } = await supabaseRequest<unknown[]>(ctx, 'coupons', {
      method: 'POST',
      body: coupon,
    });

    if (error) return { success: false, error };

    return {
      success: true,
      content: JSON.stringify(data?.[0], null, 2),
      summary: `Created coupon: ${code}`,
    };
  },
};

export const CouponValidateSchema: ToolSchema = {
  name: 'CouponValidate',
  description: 'Validate a coupon code for a given order.',
  parameters: {
    type: 'object',
    properties: {
      code: { type: 'string', description: 'Coupon code to validate' },
      order_total: { type: 'number', description: 'Current order total' },
      customer_id: { type: 'string', description: 'Customer ID (for per-customer limits)' },
    },
    required: ['code'],
  },
};

export const couponValidateTool: Tool = {
  schema: CouponValidateSchema,
  async execute(params: Record<string, unknown>): Promise<ToolResult> {
    const ctx = loadStoreContext();
    if (!ctx) return { success: false, error: 'Missing Supabase config.' };

    const { code, order_total = 0, customer_id } = params as {
      code: string; order_total?: number; customer_id?: string;
    };

    const { data, error } = await supabaseRequest<{ valid: boolean; error?: string; discount_type?: string; discount_value?: number }>(
      ctx,
      'rpc/validate_coupon',
      {
        method: 'POST',
        body: {
          p_store_id: ctx.storeId,
          p_code: code,
          p_customer_id: customer_id || null,
          p_order_total: order_total,
        },
      }
    );

    if (error) return { success: false, error };

    if (!data?.valid) {
      return { success: false, error: data?.error || 'Invalid coupon' };
    }

    return {
      success: true,
      content: JSON.stringify(data, null, 2),
      summary: `Valid: ${data.discount_type} - ${data.discount_value}${data.discount_type === 'percentage' ? '%' : ''} off`,
    };
  },
};

// =============================================================================
// Export All Tools
// =============================================================================

export const storeTools: Record<string, Tool> = {
  // Products
  ProductList: productListTool,
  ProductCreate: productCreateTool,
  ProductUpdate: productUpdateTool,
  ProductBulkUpdate: productBulkUpdateTool,
  // Categories
  CategoryList: categoryListTool,
  CategoryCreate: categoryCreateTool,
  CategoryUpdate: categoryUpdateTool,
  // Custom Fields
  FieldGroupList: fieldGroupListTool,
  FieldGroupCreate: fieldGroupCreateTool,
  // Pricing
  PricingTemplateList: pricingTemplateListTool,
  PricingTemplateCreate: pricingTemplateCreateTool,
  // Tax & Shipping
  TaxRateList: taxRateListTool,
  TaxRateSet: taxRateSetTool,
  ShippingMethodList: shippingMethodListTool,
  ShippingMethodCreate: shippingMethodCreateTool,
  // Locations & POS
  LocationList: locationListTool,
  LocationCreate: locationCreateTool,
  RegisterList: registerListTool,
  RegisterCreate: registerCreateTool,
  PaymentProcessorList: paymentProcessorListTool,
  PaymentProcessorCreate: paymentProcessorCreateTool,
  // Store Config
  StoreConfigGet: storeConfigGetTool,
  StoreConfigSet: storeConfigSetTool,
  // Inventory
  InventoryAdjust: inventoryAdjustTool,
  InventoryLowStock: inventoryLowStockTool,
  // Coupons
  CouponList: couponListTool,
  CouponCreate: couponCreateTool,
  CouponValidate: couponValidateTool,
};

export const storeSchemas: ToolSchema[] = [
  // Products
  ProductListSchema,
  ProductCreateSchema,
  ProductUpdateSchema,
  ProductBulkUpdateSchema,
  // Categories
  CategoryListSchema,
  CategoryCreateSchema,
  CategoryUpdateSchema,
  // Custom Fields
  FieldGroupListSchema,
  FieldGroupCreateSchema,
  // Pricing
  PricingTemplateListSchema,
  PricingTemplateCreateSchema,
  // Tax & Shipping
  TaxRateListSchema,
  TaxRateSetSchema,
  ShippingMethodListSchema,
  ShippingMethodCreateSchema,
  // Locations & POS
  LocationListSchema,
  LocationCreateSchema,
  RegisterListSchema,
  RegisterCreateSchema,
  PaymentProcessorListSchema,
  PaymentProcessorCreateSchema,
  // Store Config
  StoreConfigGetSchema,
  StoreConfigSetSchema,
  // Inventory
  InventoryAdjustSchema,
  InventoryLowStockSchema,
  // Coupons
  CouponListSchema,
  CouponCreateSchema,
  CouponValidateSchema,
];
