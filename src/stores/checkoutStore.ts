/**
 * Checkout Store - Multi-step checkout with Authorize.net integration
 *
 * Uses edge functions for payment processing (process-checkout).
 * Uses database module types as single source of truth.
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { config } from '../config.js';
import { authStore } from './authStore.js';
import { cartStore } from './cartStore.js';
import {
  type Cart,
  type ShippingMethod,
  type ShippingAddress,
  type AuthNetConfig,
  type SavedCard,
  type SavedAddress,
} from '../services/database/index.js';

// =============================================================================
// Types (re-export from database where possible)
// =============================================================================

export type { ShippingMethod, ShippingAddress, AuthNetConfig } from '../services/database/index.js';

export type CheckoutStep = 'cart' | 'customer' | 'shipping' | 'payment' | 'review' | 'confirmation';

export interface CustomerInfo {
  email: string;
  firstName: string;
  lastName: string;
  phone?: string;
  customerId?: string;
}

export interface BillingAddress extends ShippingAddress {
  sameAsShipping?: boolean;
}

export interface PaymentMethod {
  type: 'credit_card' | 'ach' | 'saved_card';
  opaqueData?: {
    dataDescriptor: string;
    dataValue: string;
  };
  savedCardId?: string;
  lastFour?: string;
  cardType?: string;
}

export interface OrderSummary {
  subtotal: number;
  shipping: number;
  tax: number;
  discount: number;
  total: number;
  itemCount: number;
}

export interface OrderResult {
  orderId: string;
  orderNumber: string;
  transactionId: string;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  total: number;
  createdAt: string;
}

export interface CheckoutPrefetchData {
  authNetConfig: AuthNetConfig | null;
  shippingMethods: ShippingMethod[];
  taxRates: Array<{ state: string; rate: number }>;
  savedCards: SavedCard[];
  savedAddresses: SavedAddress[];
}

export interface CheckoutStoreState {
  currentStep: CheckoutStep;
  completedSteps: CheckoutStep[];
  cart: Cart | null;
  customerInfo: CustomerInfo | null;
  shippingAddress: ShippingAddress | null;
  billingAddress: BillingAddress | null;
  shippingMethod: ShippingMethod | null;
  paymentMethod: PaymentMethod | null;
  orderSummary: OrderSummary | null;
  orderResult: OrderResult | null;
  prefetchData: CheckoutPrefetchData | null;
  isProcessing: boolean;
  error: string | null;
  validationErrors: Record<string, string>;
}

// =============================================================================
// Storage
// =============================================================================

const CHECKOUT_STORE_FILE = join(config.storageDir, 'checkout.json');

function ensureStorageDir(): void {
  mkdirSync(config.storageDir, { recursive: true });
}

// =============================================================================
// Helper: Make authenticated edge function call
// =============================================================================

async function callEdgeFunction<T>(
  functionName: string,
  body: Record<string, unknown>,
  method: 'GET' | 'POST' = 'POST'
): Promise<{ ok: true; data: T } | { ok: false; error: string }> {
  const accessToken = authStore.getAccessToken();

  if (!accessToken) {
    return { ok: false, error: 'Not authenticated' };
  }

  try {
    const options: RequestInit = {
      method,
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'apikey': config.anonKey,
        'Content-Type': 'application/json',
      },
    };

    if (method !== 'GET') {
      options.body = JSON.stringify(body);
    }

    const response = await fetch(`${config.apiUrl}/functions/v1/${functionName}`, options);

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
// Checkout Store Class
// =============================================================================

class CheckoutStore {
  private state: CheckoutStoreState = {
    currentStep: 'cart',
    completedSteps: [],
    cart: null,
    customerInfo: null,
    shippingAddress: null,
    billingAddress: null,
    shippingMethod: null,
    paymentMethod: null,
    orderSummary: null,
    orderResult: null,
    prefetchData: null,
    isProcessing: false,
    error: null,
    validationErrors: {},
  };

  private listeners: Set<(state: CheckoutStoreState) => void> = new Set();
  private cachedSnapshot: CheckoutStoreState | null = null;

  constructor() {
    this.loadFromStorage();
  }

  // ---------------------------------------------------------------------------
  // State Access
  // ---------------------------------------------------------------------------

  getState(): CheckoutStoreState {
    if (!this.cachedSnapshot) {
      this.cachedSnapshot = { ...this.state };
    }
    return this.cachedSnapshot;
  }

  getCurrentStep(): CheckoutStep {
    return this.state.currentStep;
  }

  getAuthNetConfig(): AuthNetConfig | null {
    return this.state.prefetchData?.authNetConfig || null;
  }

  getShippingMethods(): ShippingMethod[] {
    return this.state.prefetchData?.shippingMethods || [];
  }

  getSavedCards(): SavedCard[] {
    return this.state.prefetchData?.savedCards || [];
  }

  getSavedAddresses(): SavedAddress[] {
    return this.state.prefetchData?.savedAddresses || [];
  }

  getOrderSummary(): OrderSummary | null {
    return this.state.orderSummary;
  }

  getOrderResult(): OrderResult | null {
    return this.state.orderResult;
  }

  // ---------------------------------------------------------------------------
  // Step Navigation
  // ---------------------------------------------------------------------------

  async startCheckout(): Promise<boolean> {
    const cart = cartStore.getCart();

    if (!cart || cart.itemCount === 0) {
      this.setError('Cart is empty');
      return false;
    }

    this.state.cart = cart;
    this.state.currentStep = 'customer';
    this.state.orderResult = null;
    this.state.error = null;
    this.recalculateOrderSummary();
    this.persist();
    this.notify();

    if (!this.state.prefetchData) {
      await this.loadPrefetchData();
    }

    return true;
  }

  goToStep(step: CheckoutStep): void {
    const stepOrder: CheckoutStep[] = ['cart', 'customer', 'shipping', 'payment', 'review', 'confirmation'];
    const currentIndex = stepOrder.indexOf(this.state.currentStep);
    const targetIndex = stepOrder.indexOf(step);

    if (targetIndex <= currentIndex || this.state.completedSteps.includes(step)) {
      this.state.currentStep = step;
      this.state.error = null;
      this.state.validationErrors = {};
      this.notify();
    }
  }

  nextStep(): void {
    const stepOrder: CheckoutStep[] = ['cart', 'customer', 'shipping', 'payment', 'review', 'confirmation'];
    const currentIndex = stepOrder.indexOf(this.state.currentStep);

    if (currentIndex < stepOrder.length - 1) {
      if (!this.state.completedSteps.includes(this.state.currentStep)) {
        this.state.completedSteps.push(this.state.currentStep);
      }
      this.state.currentStep = stepOrder[currentIndex + 1];
      this.state.error = null;
      this.state.validationErrors = {};
      this.persist();
      this.notify();
    }
  }

  prevStep(): void {
    const stepOrder: CheckoutStep[] = ['cart', 'customer', 'shipping', 'payment', 'review', 'confirmation'];
    const currentIndex = stepOrder.indexOf(this.state.currentStep);

    if (currentIndex > 0) {
      this.state.currentStep = stepOrder[currentIndex - 1];
      this.state.error = null;
      this.notify();
    }
  }

  // ---------------------------------------------------------------------------
  // Data Setters
  // ---------------------------------------------------------------------------

  setCustomerInfo(info: CustomerInfo): void {
    this.state.customerInfo = info;
    this.state.validationErrors = {};
    this.persist();
    this.notify();
  }

  setShippingAddress(address: ShippingAddress): void {
    this.state.shippingAddress = address;
    if (this.state.billingAddress?.sameAsShipping) {
      this.state.billingAddress = { ...address, sameAsShipping: true };
    }
    this.recalculateOrderSummary();
    this.persist();
    this.notify();
  }

  setBillingAddress(address: BillingAddress): void {
    if (address.sameAsShipping && this.state.shippingAddress) {
      this.state.billingAddress = { ...this.state.shippingAddress, sameAsShipping: true };
    } else {
      this.state.billingAddress = address;
    }
    this.persist();
    this.notify();
  }

  setShippingMethod(method: ShippingMethod): void {
    this.state.shippingMethod = method;
    this.recalculateOrderSummary();
    this.persist();
    this.notify();
  }

  setPaymentMethod(method: PaymentMethod): void {
    this.state.paymentMethod = method;
    this.persist();
    this.notify();
  }

  // ---------------------------------------------------------------------------
  // Auth.net Tokenization (via Edge Function)
  // ---------------------------------------------------------------------------

  async tokenizeCard(cardData: {
    cardNumber: string;
    expirationDate: string;
    cardCode: string;
  }): Promise<{ success: boolean; opaqueData?: PaymentMethod['opaqueData']; error?: string }> {
    const authNetConfig = this.getAuthNetConfig();

    if (!authNetConfig) {
      return { success: false, error: 'Payment configuration not available' };
    }

    const result = await callEdgeFunction<{ opaqueData: PaymentMethod['opaqueData'] }>(
      'authnet-tokenize',
      cardData
    );

    if (!result.ok) {
      return { success: false, error: result.error };
    }

    return { success: true, opaqueData: result.data.opaqueData };
  }

  // ---------------------------------------------------------------------------
  // Order Processing (via Edge Function)
  // ---------------------------------------------------------------------------

  async processPayment(): Promise<boolean> {
    if (!this.validateCheckout()) {
      return false;
    }

    this.setProcessing(true);
    this.setError(null);

    const storeId = authStore.getStoreId();

    const checkoutPayload = {
      customer_id: this.state.customerInfo?.customerId || null,
      store_id: storeId,
      pickup_location_id: null,
      order_type: 'shipping',
      items: this.state.cart?.items.map(item => ({
        productId: item.productId,
        productName: item.productName,
        productSku: item.sku,
        quantity: item.quantity,
        unitPrice: item.unitPrice,
        lineTotal: item.totalPrice,
      })) || [],
      payment: {
        method: 'authorizenet',
        amount: this.state.orderSummary?.total || 0,
        opaque_data: this.state.paymentMethod?.opaqueData,
      },
      customer_email: this.state.customerInfo?.email,
      shipping_address: this.state.shippingAddress ? {
        name: `${this.state.shippingAddress.firstName} ${this.state.shippingAddress.lastName}`.trim(),
        address: this.state.shippingAddress.address1,
        city: this.state.shippingAddress.city,
        state: this.state.shippingAddress.state,
        zip: this.state.shippingAddress.postalCode,
        phone: this.state.shippingAddress.phone,
      } : null,
      billing_address: this.state.billingAddress ? {
        address: this.state.billingAddress.address1,
        city: this.state.billingAddress.city,
        state: this.state.billingAddress.state,
        zip: this.state.billingAddress.postalCode,
      } : null,
      subtotal: this.state.orderSummary?.subtotal || 0,
      taxAmount: this.state.orderSummary?.tax || 0,
      shipping: this.state.orderSummary?.shipping || 0,
      total: this.state.orderSummary?.total || 0,
      is_ecommerce: true,
    };

    const result = await callEdgeFunction<{
      success: boolean;
      data?: { orderId: string; transactionId: string };
      order_id?: string;
      transaction_id?: string;
      error?: string;
    }>('process-checkout', checkoutPayload);

    this.setProcessing(false);

    if (!result.ok) {
      this.setError(result.error);
      return false;
    }

    const orderId = result.data.data?.orderId || result.data.order_id;
    const transactionId = result.data.data?.transactionId || result.data.transaction_id;

    if (result.data.success && orderId) {
      this.state.orderResult = {
        orderId,
        orderNumber: orderId,
        transactionId: transactionId || '',
        status: 'processing',
        total: this.state.orderSummary?.total || 0,
        createdAt: new Date().toISOString(),
      };
      this.state.currentStep = 'confirmation';
      this.state.completedSteps = ['cart', 'customer', 'shipping', 'payment', 'review'];

      await cartStore.clearCart();

      this.persist();
      this.notify();
      return true;
    }

    this.setError(result.data.error || 'Order creation failed');
    return false;
  }

  // ---------------------------------------------------------------------------
  // Validation
  // ---------------------------------------------------------------------------

  validateCheckout(): boolean {
    const errors: Record<string, string> = {};

    if (!this.state.cart || this.state.cart.itemCount === 0) {
      errors.cart = 'Cart is empty';
    }
    if (!this.state.customerInfo?.email) {
      errors.email = 'Email is required';
    }
    if (!this.state.customerInfo?.firstName) {
      errors.firstName = 'First name is required';
    }
    if (!this.state.customerInfo?.lastName) {
      errors.lastName = 'Last name is required';
    }
    if (!this.state.shippingAddress) {
      errors.shippingAddress = 'Shipping address is required';
    }
    if (!this.state.shippingMethod) {
      errors.shippingMethod = 'Shipping method is required';
    }
    if (!this.state.paymentMethod) {
      errors.paymentMethod = 'Payment method is required';
    } else if (this.state.paymentMethod.type === 'credit_card' && !this.state.paymentMethod.opaqueData) {
      errors.paymentMethod = 'Card not tokenized';
    }

    this.state.validationErrors = errors;
    this.notify();

    return Object.keys(errors).length === 0;
  }

  // ---------------------------------------------------------------------------
  // Prefetch Integration
  // ---------------------------------------------------------------------------

  async loadPrefetchData(): Promise<boolean> {
    const result = await callEdgeFunction<{ prefetchData: CheckoutPrefetchData }>(
      'checkout-prefetch',
      {},
      'GET'
    );

    if (!result.ok) return false;

    this.state.prefetchData = result.data.prefetchData;
    this.persist();
    this.notify();
    return true;
  }

  initFromPrefetch(prefetchData: CheckoutPrefetchData): void {
    this.state.prefetchData = prefetchData;
    this.persist();
    this.notify();
  }

  // ---------------------------------------------------------------------------
  // Internal Helpers
  // ---------------------------------------------------------------------------

  private recalculateOrderSummary(): void {
    if (!this.state.cart) {
      this.state.orderSummary = null;
      return;
    }

    const subtotal = this.state.cart.subtotal;
    const shipping = this.state.shippingMethod?.price || 0;
    const discount = this.state.cart.discountAmount;

    let taxRate = 0;
    if (this.state.shippingAddress && this.state.prefetchData?.taxRates) {
      const stateTax = this.state.prefetchData.taxRates.find(
        (t) => t.state === this.state.shippingAddress!.state
      );
      taxRate = stateTax?.rate || 0;
    }
    const tax = (subtotal - discount) * taxRate;

    this.state.orderSummary = {
      subtotal,
      shipping,
      tax,
      discount,
      total: subtotal + shipping + tax - discount,
      itemCount: this.state.cart.itemCount,
    };
  }

  private setProcessing(isProcessing: boolean): void {
    this.state.isProcessing = isProcessing;
    this.notify();
  }

  private setError(error: string | null): void {
    this.state.error = error;
    this.notify();
  }

  reset(): void {
    this.state = {
      currentStep: 'cart',
      completedSteps: [],
      cart: null,
      customerInfo: null,
      shippingAddress: null,
      billingAddress: null,
      shippingMethod: null,
      paymentMethod: null,
      orderSummary: null,
      orderResult: null,
      prefetchData: this.state.prefetchData,
      isProcessing: false,
      error: null,
      validationErrors: {},
    };
    this.persist();
    this.notify();
  }

  // ---------------------------------------------------------------------------
  // Persistence
  // ---------------------------------------------------------------------------

  private loadFromStorage(): void {
    try {
      if (!existsSync(CHECKOUT_STORE_FILE)) return;
      const raw = readFileSync(CHECKOUT_STORE_FILE, 'utf8');
      const stored = JSON.parse(raw);
      if (stored.prefetchData) {
        this.state.prefetchData = stored.prefetchData;
      }
    } catch {
      // Ignore
    }
  }

  private persist(): void {
    try {
      ensureStorageDir();
      writeFileSync(
        CHECKOUT_STORE_FILE,
        JSON.stringify({ prefetchData: this.state.prefetchData }, null, 2)
      );
    } catch {
      // Ignore
    }
  }

  // ---------------------------------------------------------------------------
  // Subscriptions
  // ---------------------------------------------------------------------------

  subscribe(listener: (state: CheckoutStoreState) => void): () => void {
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

export const checkoutStore = new CheckoutStore();

export const getCheckoutState = () => checkoutStore.getState();
export const getCurrentCheckoutStep = () => checkoutStore.getCurrentStep();
export const getAuthNetConfigFromStore = () => checkoutStore.getAuthNetConfig();
