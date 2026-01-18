/**
 * Wilson Stores - Prefetch-enabled state management
 *
 * Provides centralized data stores with:
 * - Backend sync and prefetch support
 * - Local persistence for offline use
 * - Subscription-based reactivity
 */

export { authStore, getAuthState, isAuthenticated, getAccessToken, getStoreId } from './authStore.js';
export type { AuthPrefetchData, AuthStoreState } from './authStore.js';

export { cartStore, getCart, getCartItems, getCartTotal, isCartEmpty } from './cartStore.js';
export type { Cart, CartItem, CartPrefetchData, CartStoreState } from './cartStore.js';

export {
  checkoutStore,
  getCheckoutState,
  getCurrentCheckoutStep,
  getAuthNetConfigFromStore,
} from './checkoutStore.js';
export type {
  CheckoutStep,
  CustomerInfo,
  ShippingAddress,
  BillingAddress,
  ShippingMethod,
  PaymentMethod,
  AuthNetConfig,
  OrderSummary,
  OrderResult,
  CheckoutPrefetchData,
  CheckoutStoreState,
} from './checkoutStore.js';

export {
  posStore,
  getPosState,
  getLocation,
  getLocations,
  isSessionOpen,
  selectLocation,
  openSession,
  closeSession,
  processDejavooPayment,
} from './posStore.js';
export type {
  PosSession,
  Location,
  Register,
  PaymentProcessor,
  DejavooPaymentRequest,
  DejavooPaymentResult,
  PosStoreState,
} from './posStore.js';

// Re-export CashMovement from database module
export type { CashMovement } from '../services/database/index.js';
