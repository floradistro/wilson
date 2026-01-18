/**
 * Cart Store - Shopping cart state management
 *
 * Uses edge functions for operations requiring business logic (stock validation, pricing).
 * Uses database module for simple queries.
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { config } from '../config.js';
import { authStore } from './authStore.js';
import {
  createDatabase,
  type Cart,
  type CartItem,
  isDatabaseError,
} from '../services/database/index.js';

// =============================================================================
// Types (re-export from database module)
// =============================================================================

export type { Cart, CartItem } from '../services/database/index.js';

export interface CartPrefetchData {
  cart: Cart | null;
  recentCarts: Array<{
    id: string;
    customerId: string | null;
    itemCount: number;
    total: number;
    updatedAt: string;
  }>;
  abandonedCarts: number;
}

export interface CartStoreState {
  cart: Cart | null;
  prefetchData: CartPrefetchData | null;
  isLoading: boolean;
  isSyncing: boolean;
  lastSyncAt: number | null;
  error: string | null;
}

// =============================================================================
// Storage
// =============================================================================

const CART_STORE_FILE = join(config.storageDir, 'cart.json');
const CART_CACHE_DURATION = 30 * 60 * 1000; // 30 minutes

function ensureStorageDir(): void {
  mkdirSync(config.storageDir, { recursive: true });
}

// =============================================================================
// Helper: Get authenticated database client
// =============================================================================

function getDb() {
  const accessToken = authStore.getAccessToken();
  const storeId = authStore.getStoreId();

  if (!accessToken || !storeId) {
    return null;
  }

  return createDatabase({ accessToken, storeId });
}

// =============================================================================
// Helper: Make authenticated edge function call
// =============================================================================

async function callEdgeFunction<T>(
  functionName: string,
  body: Record<string, unknown>,
  method: 'POST' | 'DELETE' = 'POST'
): Promise<{ ok: true; data: T } | { ok: false; error: string }> {
  const accessToken = authStore.getAccessToken();

  if (!accessToken) {
    return { ok: false, error: 'Not authenticated' };
  }

  try {
    const response = await fetch(`${config.apiUrl}/functions/v1/${functionName}`, {
      method,
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'apikey': config.anonKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const error = await response.text();
      return { ok: false, error };
    }

    const data = await response.json();
    return { ok: true, data };
  } catch (error) {
    return { ok: false, error: String(error) };
  }
}

// =============================================================================
// Cart Store Class
// =============================================================================

class CartStore {
  private state: CartStoreState = {
    cart: null,
    prefetchData: null,
    isLoading: false,
    isSyncing: false,
    lastSyncAt: null,
    error: null,
  };

  private listeners: Set<(state: CartStoreState) => void> = new Set();
  private cachedSnapshot: CartStoreState | null = null;

  constructor() {
    this.loadFromStorage();
  }

  // ---------------------------------------------------------------------------
  // State Access
  // ---------------------------------------------------------------------------

  getState(): CartStoreState {
    if (!this.cachedSnapshot) {
      this.cachedSnapshot = { ...this.state };
    }
    return this.cachedSnapshot;
  }

  getCart(): Cart | null {
    return this.state.cart;
  }

  getItems(): CartItem[] {
    return this.state.cart?.items || [];
  }

  getItemCount(): number {
    return this.state.cart?.itemCount || 0;
  }

  getTotal(): number {
    return this.state.cart?.total || 0;
  }

  isEmpty(): boolean {
    return this.getItemCount() === 0;
  }

  // ---------------------------------------------------------------------------
  // Cart Operations (via Edge Functions for business logic)
  // ---------------------------------------------------------------------------

  async addItem(
    productId: string,
    quantity: number = 1,
    variant?: Record<string, unknown>
  ): Promise<boolean> {
    this.setSyncing(true);

    const result = await callEdgeFunction<{ cart: Cart }>('cart-add', {
      cartId: this.state.cart?.id,
      productId,
      quantity,
      variant,
    });

    this.setSyncing(false);

    if (!result.ok) {
      this.setError(`Failed to add item: ${result.error}`);
      return false;
    }

    this.updateCart(result.data.cart);
    return true;
  }

  async updateItemQuantity(itemId: string, quantity: number): Promise<boolean> {
    if (quantity <= 0) {
      return this.removeItem(itemId);
    }

    // Optimistic update
    const previousCart = this.state.cart;
    if (previousCart) {
      const items = previousCart.items.map((item) =>
        item.id === itemId
          ? { ...item, quantity, totalPrice: item.unitPrice * quantity }
          : item
      );
      this.updateCartLocally({ ...previousCart, items });
    }

    this.setSyncing(true);

    const result = await callEdgeFunction<{ cart: Cart }>('cart-update', {
      cartId: this.state.cart?.id,
      itemId,
      quantity,
    });

    this.setSyncing(false);

    if (!result.ok) {
      if (previousCart) this.updateCart(previousCart);
      this.setError(`Failed to update quantity: ${result.error}`);
      return false;
    }

    this.updateCart(result.data.cart);
    return true;
  }

  async removeItem(itemId: string): Promise<boolean> {
    // Optimistic update
    const previousCart = this.state.cart;
    if (previousCart) {
      const items = previousCart.items.filter((item) => item.id !== itemId);
      this.updateCartLocally({ ...previousCart, items });
    }

    this.setSyncing(true);

    const result = await callEdgeFunction<{ cart: Cart }>('cart-remove', {
      cartId: this.state.cart?.id,
      itemId,
    });

    this.setSyncing(false);

    if (!result.ok) {
      if (previousCart) this.updateCart(previousCart);
      this.setError(`Failed to remove item: ${result.error}`);
      return false;
    }

    this.updateCart(result.data.cart);
    return true;
  }

  async applyCoupon(couponCode: string): Promise<boolean> {
    if (!this.state.cart?.id) {
      this.setError('No cart');
      return false;
    }

    this.setSyncing(true);

    const result = await callEdgeFunction<{ cart: Cart }>('cart-coupon', {
      cartId: this.state.cart.id,
      couponCode,
    });

    this.setSyncing(false);

    if (!result.ok) {
      this.setError(`Invalid coupon: ${result.error}`);
      return false;
    }

    this.updateCart(result.data.cart);
    return true;
  }

  async removeCoupon(): Promise<boolean> {
    if (!this.state.cart?.id) return false;

    this.setSyncing(true);

    const result = await callEdgeFunction<{ cart: Cart }>(
      'cart-coupon',
      { cartId: this.state.cart.id },
      'DELETE'
    );

    this.setSyncing(false);

    if (!result.ok) return false;

    this.updateCart(result.data.cart);
    return true;
  }

  async clearCart(): Promise<void> {
    if (this.state.cart?.id) {
      await callEdgeFunction('cart-clear', { cartId: this.state.cart.id });
    }

    this.state.cart = null;
    this.persist();
    this.notify();
  }

  // ---------------------------------------------------------------------------
  // POS Operations (via Database Module)
  // ---------------------------------------------------------------------------

  async createPosCart(locationId: string, customerId?: string): Promise<boolean> {
    const db = getDb();
    if (!db) {
      this.setError('Not authenticated');
      return false;
    }

    this.setLoading(true);

    try {
      const cart = await db.cart.createCart({
        locationId,
        customerId,
        cartType: 'pos',
      });

      this.updateCart(cart);
      return true;
    } catch (error) {
      if (isDatabaseError(error)) {
        this.setError(error.message);
      } else {
        this.setError('Failed to create cart');
      }
      return false;
    } finally {
      this.setLoading(false);
    }
  }

  async getQueue(locationId: string): Promise<Array<{
    id: string;
    cartId: string;
    customerId: string | null;
    position: number;
    status: string;
    addedAt: string;
  }>> {
    const db = getDb();
    if (!db) return [];

    try {
      return await db.pos.getQueue(locationId);
    } catch {
      return [];
    }
  }

  async addToQueue(locationId: string, customerId?: string): Promise<boolean> {
    const db = getDb();
    if (!db || !this.state.cart?.id) {
      this.setError('No cart to add to queue');
      return false;
    }

    try {
      await db.pos.addToQueue(locationId, this.state.cart.id, customerId);
      return true;
    } catch (error) {
      if (isDatabaseError(error)) {
        this.setError(error.message);
      }
      return false;
    }
  }

  // ---------------------------------------------------------------------------
  // Prefetch Integration
  // ---------------------------------------------------------------------------

  async loadFromBackend(): Promise<boolean> {
    const db = getDb();
    if (!db) return false;

    this.setLoading(true);

    try {
      // Use edge function for prefetch (has aggregated data)
      const result = await callEdgeFunction<{
        cart: Cart | null;
        prefetchData: CartPrefetchData;
      }>('cart-prefetch', {});

      if (!result.ok) return false;

      if (result.data.cart) {
        this.updateCart(result.data.cart);
      }

      if (result.data.prefetchData) {
        this.state.prefetchData = result.data.prefetchData;
      }

      this.state.lastSyncAt = Date.now();
      this.persist();
      this.notify();
      return true;
    } catch {
      return false;
    } finally {
      this.setLoading(false);
    }
  }

  initFromPrefetch(prefetchData: CartPrefetchData): void {
    this.state.prefetchData = prefetchData;
    if (prefetchData.cart) {
      this.state.cart = prefetchData.cart;
    }
    this.state.lastSyncAt = Date.now();
    this.persist();
    this.notify();
  }

  // ---------------------------------------------------------------------------
  // Internal State Updates
  // ---------------------------------------------------------------------------

  private updateCart(cart: Cart): void {
    this.state.cart = cart;
    this.state.error = null;
    this.state.lastSyncAt = Date.now();
    this.persist();
    this.notify();
  }

  private updateCartLocally(cart: Cart): void {
    const items = cart.items;
    const subtotal = items.reduce((sum, item) => sum + item.totalPrice, 0);
    const itemCount = items.reduce((sum, item) => sum + item.quantity, 0);

    this.state.cart = {
      ...cart,
      items,
      subtotal,
      itemCount,
      total: subtotal + cart.taxAmount - cart.discountAmount,
      updatedAt: new Date().toISOString(),
    };
    this.notify();
  }

  private setLoading(isLoading: boolean): void {
    this.state.isLoading = isLoading;
    this.notify();
  }

  private setSyncing(isSyncing: boolean): void {
    this.state.isSyncing = isSyncing;
    this.notify();
  }

  private setError(error: string): void {
    this.state.error = error;
    this.notify();
  }

  // ---------------------------------------------------------------------------
  // Persistence
  // ---------------------------------------------------------------------------

  private loadFromStorage(): void {
    try {
      if (!existsSync(CART_STORE_FILE)) return;

      const raw = readFileSync(CART_STORE_FILE, 'utf8');
      const stored = JSON.parse(raw);

      if (stored.lastSyncAt && Date.now() - stored.lastSyncAt < CART_CACHE_DURATION) {
        this.state.cart = stored.cart || null;
        this.state.prefetchData = stored.prefetchData || null;
        this.state.lastSyncAt = stored.lastSyncAt;
      }
    } catch {
      // Ignore
    }
  }

  private persist(): void {
    try {
      ensureStorageDir();
      writeFileSync(
        CART_STORE_FILE,
        JSON.stringify({
          cart: this.state.cart,
          prefetchData: this.state.prefetchData,
          lastSyncAt: this.state.lastSyncAt,
        }, null, 2)
      );
    } catch {
      // Ignore
    }
  }

  // ---------------------------------------------------------------------------
  // Subscriptions
  // ---------------------------------------------------------------------------

  subscribe(listener: (state: CartStoreState) => void): () => void {
    this.listeners.add(listener);
    listener(this.getState());
    return () => this.listeners.delete(listener);
  }

  private notify(): void {
    this.cachedSnapshot = null;
    const state = this.getState();
    this.listeners.forEach((listener) => listener(state));
  }
}

// =============================================================================
// Singleton Export
// =============================================================================

export const cartStore = new CartStore();

// Convenience exports
export const getCart = () => cartStore.getCart();
export const getCartItems = () => cartStore.getItems();
export const getCartTotal = () => cartStore.getTotal();
export const isCartEmpty = () => cartStore.isEmpty();
