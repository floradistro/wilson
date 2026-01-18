/**
 * Products Module
 *
 * Handles product and category queries with prefetch support.
 */

import { BaseClient, type ClientConfig } from './client.js';
import { DatabaseError } from './errors.js';
import type { BootstrapData } from '../bootstrap.js';
import { getPrefetchData } from '../bootstrap.js';

// =============================================================================
// Types
// =============================================================================

export interface Product {
  id: string;
  name: string;
  description?: string;
  categoryName?: string;
  regularPrice?: number;
  featuredImage?: string;
  sku?: string;
  status: string;
  strainType?: string;
  thcaPercentage?: number;
  genetics?: string;
  effects?: string;
  terpenes?: string;
  customFields?: Record<string, unknown>;
  quantity?: number;
}

export interface Category {
  id: string;
  name: string;
  productCount?: number;
}

export interface ProductQueryOptions {
  category?: string;
  inStock?: boolean;
  search?: string;
  limit?: number;
  usePrefetch?: boolean;
}

// =============================================================================
// Products Client
// =============================================================================

export class ProductsClient extends BaseClient {
  private bootstrap: BootstrapData | null;

  constructor(config: ClientConfig, bootstrap?: BootstrapData | null) {
    super(config);
    this.bootstrap = bootstrap ?? null;
  }

  /**
   * Get products with optional filtering
   */
  async getProducts(options: ProductQueryOptions = {}): Promise<Product[]> {
    // Try prefetch first
    if (options.usePrefetch !== false && this.bootstrap) {
      const prefetched = this.tryPrefetch(options);
      if (prefetched) return prefetched;
    }

    // Build query
    const params = new URLSearchParams();

    params.append(
      'select',
      'id,name,description,category_name,regular_price,featured_image,sku,status,strain_type,thca_percentage,genetics,effects,terpenes,custom_fields,inventory(quantity)'
    );

    // Filters
    if (options.category) {
      params.append('category_name', `ilike.%${options.category}%`);
    }

    if (options.search) {
      params.append(
        'or',
        `(name.ilike.%${options.search}%,description.ilike.%${options.search}%,sku.ilike.%${options.search}%)`
      );
    }

    params.append('status', 'eq.published');
    params.append('limit', String(options.limit || 50));

    const raw = await this.get<RawProduct[]>('products', Object.fromEntries(params));

    // Transform and filter
    let products = raw.map(transformProduct);

    if (options.inStock === true) {
      products = products.filter(p => (p.quantity || 0) > 0);
    } else if (options.inStock === false) {
      products = products.filter(p => (p.quantity || 0) === 0);
    }

    return products;
  }

  /**
   * Get a single product by ID
   */
  async getProductById(id: string): Promise<Product> {
    const params = new URLSearchParams();
    params.append(
      'select',
      'id,name,description,category_name,regular_price,featured_image,sku,status,strain_type,thca_percentage,genetics,effects,terpenes,custom_fields,inventory(quantity)'
    );
    params.append('id', `eq.${id}`);

    const raw = await this.get<RawProduct[]>('products', Object.fromEntries(params));

    if (!raw.length) {
      throw DatabaseError.notFound('Product', id);
    }

    return transformProduct(raw[0]);
  }

  /**
   * Get all categories
   */
  async getCategories(): Promise<Category[]> {
    // Try prefetch
    if (this.bootstrap) {
      const prefetched = getPrefetchData(this.bootstrap, 'categories');
      if (prefetched) {
        return prefetched;
      }
    }

    const params = new URLSearchParams();
    params.append('select', 'id,name');
    params.append('order', 'name.asc');

    return this.get<Category[]>('categories', Object.fromEntries(params));
  }

  /**
   * Get inventory levels
   */
  async getInventoryLevels(categoryName?: string): Promise<Array<{
    productId: string;
    productName: string;
    categoryName: string;
    quantity: number;
    lowStockThreshold?: number;
  }>> {
    const params = new URLSearchParams();
    params.append('select', 'product_id,quantity,products(name,category_name,low_stock_threshold)');

    if (categoryName) {
      params.append('products.category_name', `ilike.%${categoryName}%`);
    }

    params.append('order', 'quantity.asc');

    const raw = await this.get<Array<{
      product_id: string;
      quantity: number;
      products?: {
        name: string;
        category_name: string;
        low_stock_threshold?: number;
      };
    }>>('inventory', Object.fromEntries(params));

    return raw.map(item => ({
      productId: item.product_id,
      productName: item.products?.name || 'Unknown',
      categoryName: item.products?.category_name || 'Unknown',
      quantity: item.quantity || 0,
      lowStockThreshold: item.products?.low_stock_threshold,
    }));
  }

  /**
   * Try to use prefetched data
   */
  private tryPrefetch(options: ProductQueryOptions): Product[] | null {
    if (!this.bootstrap) return null;

    const prefetchedProducts = getPrefetchData(this.bootstrap, 'products');
    const prefetchedInStock = getPrefetchData(this.bootstrap, 'products_in_stock');
    const prefetchedTopProducts = getPrefetchData(this.bootstrap, 'top_products');

    let products: RawProduct[] = [];

    if (options.inStock === true && prefetchedInStock) {
      products = prefetchedInStock;
    } else if (prefetchedTopProducts && !options.category && !options.search) {
      products = prefetchedTopProducts;
    } else if (prefetchedProducts) {
      products = prefetchedProducts;
    }

    if (products.length === 0) return null;

    // Apply client-side filtering
    let filtered = products.map(transformProduct);

    if (options.category) {
      const cat = options.category.toLowerCase();
      filtered = filtered.filter(p => p.categoryName?.toLowerCase().includes(cat));
    }

    if (options.search) {
      const search = options.search.toLowerCase();
      filtered = filtered.filter(p =>
        p.name?.toLowerCase().includes(search) ||
        p.description?.toLowerCase().includes(search) ||
        p.sku?.toLowerCase().includes(search)
      );
    }

    if (options.inStock === true) {
      filtered = filtered.filter(p => (p.quantity || 0) > 0);
    } else if (options.inStock === false) {
      filtered = filtered.filter(p => (p.quantity || 0) === 0);
    }

    if (options.limit) {
      filtered = filtered.slice(0, options.limit);
    }

    return filtered;
  }
}

// =============================================================================
// Raw Types (API response shape)
// =============================================================================

interface RawProduct {
  id: string;
  name: string;
  description?: string;
  category_name?: string;
  regular_price?: number;
  featured_image?: string;
  sku?: string;
  status: string;
  strain_type?: string;
  thca_percentage?: number;
  genetics?: string;
  effects?: string;
  terpenes?: string;
  custom_fields?: Record<string, unknown>;
  inventory?: Array<{ quantity: number }>;
  quantity?: number;
}

// =============================================================================
// Transformers
// =============================================================================

function transformProduct(raw: RawProduct): Product {
  return {
    id: raw.id,
    name: raw.name,
    description: raw.description,
    categoryName: raw.category_name,
    regularPrice: raw.regular_price,
    featuredImage: raw.featured_image,
    sku: raw.sku,
    status: raw.status,
    strainType: raw.strain_type,
    thcaPercentage: raw.thca_percentage,
    genetics: raw.genetics,
    effects: raw.effects,
    terpenes: raw.terpenes,
    customFields: raw.custom_fields,
    quantity: raw.inventory?.[0]?.quantity ?? raw.quantity,
  };
}
