/**
 * Database Module
 *
 * Unified database client with domain-specific modules:
 * - Products: Product catalog and inventory
 * - Cart: Shopping cart operations
 * - Checkout: Shipping, tax, payment config
 * - POS: Point-of-sale operations
 *
 * Usage:
 *   const db = createDatabase({ accessToken, storeId });
 *   const products = await db.products.getProducts({ inStock: true });
 *   const cart = await db.cart.createCart();
 */

import { config } from '../../config.js';
import type { BootstrapData } from '../bootstrap.js';
import type { ClientConfig } from './client.js';
import { ProductsClient } from './products.js';
import { CartClient } from './cart.js';
import { CheckoutClient } from './checkout.js';
import { PosClient } from './pos.js';

// =============================================================================
// Re-exports
// =============================================================================

// Errors
export { DatabaseError, DatabaseErrorCode, isDatabaseError, isRetryableError } from './errors.js';
export type { DatabaseErrorDetails } from './errors.js';

// Client
export { BaseClient } from './client.js';
export type { ClientConfig, RequestOptions } from './client.js';

// Products
export { ProductsClient } from './products.js';
export type { Product, Category, ProductQueryOptions } from './products.js';

// Cart
export { CartClient } from './cart.js';
export type { Cart, CartItem, AddToCartInput } from './cart.js';

// Checkout
export { CheckoutClient } from './checkout.js';
export type {
  ShippingMethod,
  TaxRate,
  AuthNetConfig,
  ShippingAddress,
  SavedAddress,
  SavedCard,
  Customer,
  Order,
} from './checkout.js';

// POS
export { PosClient } from './pos.js';
export type {
  Location,
  Register,
  PaymentProcessor,
  PosSession,
  CashMovement,
  QueueEntry,
  DejavooPaymentRequest,
  DejavooPaymentResult,
} from './pos.js';

// =============================================================================
// Database Client
// =============================================================================

export interface DatabaseClientOptions {
  accessToken: string;
  storeId: string;
  bootstrap?: BootstrapData | null;
  debug?: boolean;
}

/**
 * Unified database client with all domain modules
 */
export class DatabaseClient {
  readonly products: ProductsClient;
  readonly cart: CartClient;
  readonly checkout: CheckoutClient;
  readonly pos: PosClient;

  private readonly config: ClientConfig;

  constructor(options: DatabaseClientOptions) {
    this.config = {
      baseUrl: config.apiUrl,
      anonKey: config.anonKey,
      accessToken: options.accessToken,
      debug: options.debug,
    };

    this.products = new ProductsClient(this.config, options.bootstrap);
    this.cart = new CartClient(this.config, options.bootstrap);
    this.checkout = new CheckoutClient(this.config, options.bootstrap);
    this.pos = new PosClient(this.config);
  }

  /**
   * Get the current configuration
   */
  getConfig(): Readonly<ClientConfig> {
    return { ...this.config };
  }
}

// =============================================================================
// Factory Function
// =============================================================================

/**
 * Create a database client
 *
 * @example
 * const db = createDatabase({
 *   accessToken: 'your-token',
 *   storeId: 'store-123',
 * });
 *
 * // Products
 * const products = await db.products.getProducts({ inStock: true });
 * const product = await db.products.getProductById('prod-1');
 *
 * // Cart
 * const cart = await db.cart.createCart({ customerId: 'cust-1' });
 * await db.cart.addItem(cart.id, { productId: 'prod-1', quantity: 2 });
 *
 * // Checkout
 * const shipping = await db.checkout.getShippingMethods();
 * const taxRate = await db.checkout.getTaxRate('CA');
 *
 * // POS
 * const locations = await db.pos.getLocations();
 * const session = await db.pos.openSession(registerId, userId, 100);
 */
export function createDatabase(options: DatabaseClientOptions): DatabaseClient {
  return new DatabaseClient(options);
}

// =============================================================================
// Legacy Compatibility
// =============================================================================

/**
 * @deprecated Use createDatabase() instead
 *
 * Legacy factory function for backwards compatibility.
 * Will be removed in a future version.
 */
export function createDatabaseClient(
  accessToken: string,
  storeId: string,
  bootstrap?: BootstrapData | null
): DatabaseClient {
  return createDatabase({ accessToken, storeId, bootstrap });
}
