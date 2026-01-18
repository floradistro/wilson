/**
 * Cart Module
 *
 * Handles cart operations including items, totals, and transformations.
 */

import { BaseClient, type ClientConfig } from './client.js';
import { DatabaseError } from './errors.js';
import { ProductsClient } from './products.js';
import type { BootstrapData } from '../bootstrap.js';
import { getPrefetchData } from '../bootstrap.js';

// =============================================================================
// Types
// =============================================================================

export interface Cart {
  id: string;
  storeId: string;
  locationId?: string;
  customerId?: string;
  customerEmail?: string;
  items: CartItem[];
  subtotal: number;
  taxAmount: number;
  discountAmount: number;
  total: number;
  itemCount: number;
  couponCode?: string;
  notes?: string;
  cartType: 'ecommerce' | 'pos';
  createdAt: string;
  updatedAt: string;
  expiresAt: string;
}

export interface CartItem {
  id: string;
  productId: string;
  productName: string;
  sku: string;
  quantity: number;
  unitPrice: number;
  totalPrice: number;
  imageUrl?: string;
  variant?: Record<string, unknown>;
  customFields?: Record<string, unknown>;
}

export interface AddToCartInput {
  productId: string;
  quantity: number;
  variant?: Record<string, unknown>;
}

// =============================================================================
// Cart Client
// =============================================================================

export class CartClient extends BaseClient {
  private bootstrap: BootstrapData | null;
  private productsClient: ProductsClient;

  constructor(config: ClientConfig, bootstrap?: BootstrapData | null) {
    super(config);
    this.bootstrap = bootstrap ?? null;
    this.productsClient = new ProductsClient(config, bootstrap);
  }

  /**
   * Get cart by ID
   */
  async getCart(cartId: string): Promise<Cart | null> {
    // Try prefetch
    if (this.bootstrap) {
      const prefetched = getPrefetchData(this.bootstrap, 'cart');
      if (prefetched?.cart && prefetched.cart.id === cartId) {
        return transformCart(prefetched.cart);
      }
    }

    const params = new URLSearchParams();
    params.append('select', '*,cart_items(*)');
    params.append('id', `eq.${cartId}`);

    const raw = await this.get<RawCart[]>('carts', Object.fromEntries(params));
    return raw[0] ? transformCart(raw[0]) : null;
  }

  /**
   * Get active cart for customer
   */
  async getActiveCart(customerId: string): Promise<Cart | null> {
    const params = new URLSearchParams();
    params.append('select', '*,cart_items(*)');
    params.append('customer_id', `eq.${customerId}`);
    params.append('expires_at', `gt.${new Date().toISOString()}`);
    params.append('order', 'created_at.desc');
    params.append('limit', '1');

    const raw = await this.get<RawCart[]>('carts', Object.fromEntries(params));
    return raw[0] ? transformCart(raw[0]) : null;
  }

  /**
   * Create a new cart
   */
  async createCart(options: {
    customerId?: string;
    locationId?: string;
    cartType?: 'ecommerce' | 'pos';
  } = {}): Promise<Cart> {
    const { customerId, locationId, cartType = 'ecommerce' } = options;

    // POS carts expire in 4 hours, e-commerce in 24 hours
    const expiresIn = cartType === 'pos' ? 4 * 60 * 60 * 1000 : 24 * 60 * 60 * 1000;

    const raw = await this.post<RawCart[]>('carts', {
      customer_id: customerId || null,
      location_id: locationId || null,
      cart_type: cartType,
      expires_at: new Date(Date.now() + expiresIn).toISOString(),
    });

    return transformCart(raw[0]);
  }

  /**
   * Add item to cart
   */
  async addItem(cartId: string, input: AddToCartInput): Promise<CartItem> {
    // Get product details
    const product = await this.productsClient.getProductById(input.productId);

    // Check stock
    if (product.quantity !== undefined && product.quantity < input.quantity) {
      throw DatabaseError.insufficientStock(
        input.productId,
        input.quantity,
        product.quantity
      );
    }

    const raw = await this.post<RawCartItem[]>('cart_items', {
      cart_id: cartId,
      product_id: input.productId,
      product_name: product.name,
      sku: product.sku || '',
      quantity: input.quantity,
      unit_price: product.regularPrice || 0,
      total_price: (product.regularPrice || 0) * input.quantity,
      image_url: product.featuredImage || null,
      variant: input.variant ? JSON.stringify(input.variant) : null,
    });

    return transformCartItem(raw[0]);
  }

  /**
   * Update cart item quantity
   */
  async updateItem(itemId: string, quantity: number): Promise<CartItem> {
    if (quantity < 1) {
      throw DatabaseError.validation('Quantity must be at least 1');
    }

    // Get current item for unit price
    const params = new URLSearchParams();
    params.append('id', `eq.${itemId}`);

    const current = await this.get<RawCartItem[]>('cart_items', Object.fromEntries(params));

    if (!current[0]) {
      throw DatabaseError.notFound('CartItem', itemId);
    }

    const unitPrice = current[0].unit_price;

    const updateParams = new URLSearchParams();
    updateParams.append('id', `eq.${itemId}`);

    const raw = await this.patch<RawCartItem[]>(
      'cart_items',
      {
        quantity,
        total_price: unitPrice * quantity,
      },
      Object.fromEntries(updateParams)
    );

    return transformCartItem(raw[0]);
  }

  /**
   * Remove item from cart
   */
  async removeItem(itemId: string): Promise<void> {
    const params = new URLSearchParams();
    params.append('id', `eq.${itemId}`);

    await this.delete('cart_items', Object.fromEntries(params));
  }

  /**
   * Clear all items from cart
   */
  async clearCart(cartId: string): Promise<void> {
    const params = new URLSearchParams();
    params.append('cart_id', `eq.${cartId}`);

    await this.delete('cart_items', Object.fromEntries(params));
  }

  /**
   * Apply coupon to cart
   */
  async applyCoupon(cartId: string, couponCode: string): Promise<Cart> {
    const params = new URLSearchParams();
    params.append('id', `eq.${cartId}`);

    // TODO: Validate coupon and calculate discount
    const raw = await this.patch<RawCart[]>(
      'carts',
      { coupon_code: couponCode },
      Object.fromEntries(params)
    );

    // Refetch with items
    return this.getCart(cartId) as Promise<Cart>;
  }

  /**
   * Remove coupon from cart
   */
  async removeCoupon(cartId: string): Promise<Cart> {
    const params = new URLSearchParams();
    params.append('id', `eq.${cartId}`);

    await this.patch<RawCart[]>(
      'carts',
      { coupon_code: null, discount_amount: 0 },
      Object.fromEntries(params)
    );

    return this.getCart(cartId) as Promise<Cart>;
  }

  /**
   * Update cart notes
   */
  async updateNotes(cartId: string, notes: string): Promise<void> {
    const params = new URLSearchParams();
    params.append('id', `eq.${cartId}`);

    await this.patch<RawCart[]>('carts', { notes }, Object.fromEntries(params));
  }
}

// =============================================================================
// Raw Types (API response shape)
// =============================================================================

interface RawCart {
  id: string;
  store_id: string;
  location_id?: string;
  customer_id?: string;
  customer_email?: string;
  cart_items?: RawCartItem[];
  tax_amount?: number;
  discount_amount?: number;
  coupon_code?: string;
  notes?: string;
  cart_type?: string;
  created_at: string;
  updated_at: string;
  expires_at: string;
}

interface RawCartItem {
  id: string;
  product_id: string;
  product_name: string;
  sku: string;
  quantity: number;
  unit_price: number;
  total_price: number;
  image_url?: string;
  variant?: string;
  custom_fields?: string;
}

// =============================================================================
// Transformers
// =============================================================================

function transformCart(raw: RawCart): Cart {
  const items = (raw.cart_items || []).map(transformCartItem);
  const subtotal = items.reduce((sum, item) => sum + item.totalPrice, 0);
  const itemCount = items.reduce((sum, item) => sum + item.quantity, 0);

  return {
    id: raw.id,
    storeId: raw.store_id,
    locationId: raw.location_id,
    customerId: raw.customer_id,
    customerEmail: raw.customer_email,
    items,
    subtotal,
    taxAmount: raw.tax_amount || 0,
    discountAmount: raw.discount_amount || 0,
    total: subtotal + (raw.tax_amount || 0) - (raw.discount_amount || 0),
    itemCount,
    couponCode: raw.coupon_code,
    notes: raw.notes,
    cartType: (raw.cart_type as 'ecommerce' | 'pos') || 'ecommerce',
    createdAt: raw.created_at,
    updatedAt: raw.updated_at,
    expiresAt: raw.expires_at,
  };
}

function transformCartItem(raw: RawCartItem): CartItem {
  return {
    id: raw.id,
    productId: raw.product_id,
    productName: raw.product_name,
    sku: raw.sku,
    quantity: raw.quantity,
    unitPrice: raw.unit_price,
    totalPrice: raw.total_price,
    imageUrl: raw.image_url,
    variant: raw.variant ? JSON.parse(raw.variant) : undefined,
    customFields: raw.custom_fields ? JSON.parse(raw.custom_fields) : undefined,
  };
}
