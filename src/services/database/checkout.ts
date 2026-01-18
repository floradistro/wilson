/**
 * Checkout Module
 *
 * Handles checkout operations, shipping, tax, and payment configuration.
 */

import { BaseClient, type ClientConfig } from './client.js';
import type { BootstrapData } from '../bootstrap.js';
import { getPrefetchData } from '../bootstrap.js';

// =============================================================================
// Types
// =============================================================================

export interface ShippingMethod {
  id: string;
  name: string;
  description?: string;
  price: number;
  estimatedDays: string;
  carrier?: string;
  isActive: boolean;
}

export interface TaxRate {
  state: string;
  rate: number;
  county?: string;
  city?: string;
}

export interface AuthNetConfig {
  clientKey: string;
  apiLoginId: string;
  environment: 'sandbox' | 'production';
}

export interface ShippingAddress {
  firstName: string;
  lastName: string;
  company?: string;
  address1: string;
  address2?: string;
  city: string;
  state: string;
  postalCode: string;
  country: string;
  phone?: string;
}

export interface SavedAddress extends ShippingAddress {
  id: string;
  isDefault: boolean;
}

export interface SavedCard {
  id: string;
  lastFour: string;
  cardType: string;
  expiryMonth: number;
  expiryYear: number;
  isDefault: boolean;
}

export interface Customer {
  id: string;
  firstName: string;
  lastName: string;
  email?: string;
  phone?: string;
  loyaltyTier?: string;
  totalSpent?: number;
  totalPoints?: number;
  orderCount?: number;
}

export interface Order {
  id: string;
  orderNumber: string;
  status: string;
  totalAmount: number;
  createdAt: string;
  customerName?: string;
  itemCount?: number;
}

// =============================================================================
// Checkout Client
// =============================================================================

export class CheckoutClient extends BaseClient {
  private bootstrap: BootstrapData | null;

  constructor(config: ClientConfig, bootstrap?: BootstrapData | null) {
    super(config);
    this.bootstrap = bootstrap ?? null;
  }

  /**
   * Get available shipping methods
   */
  async getShippingMethods(): Promise<ShippingMethod[]> {
    // Try prefetch
    if (this.bootstrap) {
      const checkoutData = getPrefetchData(this.bootstrap, 'checkout');
      if (checkoutData?.shippingMethods) {
        return checkoutData.shippingMethods;
      }
    }

    const params = new URLSearchParams();
    params.append('select', '*');
    params.append('is_active', 'eq.true');
    params.append('order', 'price.asc');

    const raw = await this.get<RawShippingMethod[]>('shipping_methods', Object.fromEntries(params));
    return raw.map(transformShippingMethod);
  }

  /**
   * Get tax rate for state
   */
  async getTaxRate(state: string): Promise<number> {
    // Try prefetch
    if (this.bootstrap) {
      const checkoutData = getPrefetchData(this.bootstrap, 'checkout');
      if (checkoutData?.taxRates) {
        const rate = checkoutData.taxRates.find((r: TaxRate) => r.state === state);
        if (rate) return rate.rate;
      }
    }

    const params = new URLSearchParams();
    params.append('select', 'rate');
    params.append('state', `eq.${state}`);

    try {
      const raw = await this.get<Array<{ rate: number }>>('tax_rates', Object.fromEntries(params));
      return raw[0]?.rate || 0;
    } catch {
      return 0;
    }
  }

  /**
   * Get Auth.net configuration for e-commerce
   */
  async getAuthNetConfig(): Promise<AuthNetConfig | null> {
    // Try prefetch
    if (this.bootstrap) {
      const checkoutData = getPrefetchData(this.bootstrap, 'checkout');
      if (checkoutData?.authNetConfig) {
        return checkoutData.authNetConfig;
      }
    }

    const params = new URLSearchParams();
    params.append('select', 'authorizenet_public_client_key,authorizenet_api_login_id,environment');
    params.append('processor_type', 'eq.authorizenet');
    params.append('is_ecommerce_processor', 'eq.true');
    params.append('is_active', 'eq.true');

    try {
      const raw = await this.get<Array<{
        authorizenet_public_client_key: string;
        authorizenet_api_login_id: string;
        environment: string;
      }>>('payment_processors', Object.fromEntries(params));

      if (!raw[0] || !raw[0].authorizenet_api_login_id) {
        return null;
      }

      return {
        clientKey: raw[0].authorizenet_public_client_key,
        apiLoginId: raw[0].authorizenet_api_login_id,
        environment: raw[0].environment as 'sandbox' | 'production',
      };
    } catch {
      return null;
    }
  }

  /**
   * Get saved addresses for customer
   */
  async getSavedAddresses(customerId: string): Promise<SavedAddress[]> {
    const params = new URLSearchParams();
    params.append('select', '*');
    params.append('customer_id', `eq.${customerId}`);
    params.append('order', 'is_default.desc,created_at.desc');

    try {
      const raw = await this.get<RawAddress[]>('customer_addresses', Object.fromEntries(params));
      return raw.map(transformAddress);
    } catch {
      return [];
    }
  }

  /**
   * Save address for customer
   */
  async saveAddress(customerId: string, address: ShippingAddress, isDefault = false): Promise<SavedAddress> {
    const raw = await this.post<RawAddress[]>('customer_addresses', {
      customer_id: customerId,
      first_name: address.firstName,
      last_name: address.lastName,
      company: address.company,
      address1: address.address1,
      address2: address.address2,
      city: address.city,
      state: address.state,
      postal_code: address.postalCode,
      country: address.country,
      phone: address.phone,
      is_default: isDefault,
    });

    return transformAddress(raw[0]);
  }

  /**
   * Get saved cards for customer
   */
  async getSavedCards(customerId: string): Promise<SavedCard[]> {
    const params = new URLSearchParams();
    params.append('select', '*');
    params.append('customer_id', `eq.${customerId}`);
    params.append('order', 'is_default.desc,created_at.desc');

    try {
      const raw = await this.get<RawCard[]>('customer_payment_profiles', Object.fromEntries(params));
      return raw.map(transformCard);
    } catch {
      return [];
    }
  }

  /**
   * Search customers
   */
  async searchCustomers(query: string, limit = 20): Promise<Customer[]> {
    const params = new URLSearchParams();
    params.append('select', 'id,first_name,last_name,email,phone,loyalty_tier,total_spent,total_points');
    params.append(
      'or',
      `(first_name.ilike.%${query}%,last_name.ilike.%${query}%,email.ilike.%${query}%,phone.ilike.%${query}%)`
    );
    params.append('limit', String(limit));
    params.append('order', 'first_name.asc,last_name.asc');

    const raw = await this.get<RawCustomer[]>('customers', Object.fromEntries(params));
    return raw.map(transformCustomer);
  }

  /**
   * Get recent orders
   */
  async getRecentOrders(limit = 10): Promise<Order[]> {
    const params = new URLSearchParams();
    params.append('select', 'id,order_number,status,total_amount,created_at,customers(first_name,last_name)');
    params.append('order', 'created_at.desc');
    params.append('limit', String(limit));

    const raw = await this.get<RawOrder[]>('orders', Object.fromEntries(params));
    return raw.map(transformOrder);
  }

  /**
   * Get sales analytics
   */
  async getSalesAnalytics(days = 30): Promise<{
    totalRevenue: number;
    totalOrders: number;
    averageOrderValue: number;
  }> {
    const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

    const params = new URLSearchParams();
    params.append('select', 'total_amount');
    params.append('status', 'eq.completed');
    params.append('created_at', `gte.${cutoff}`);

    const raw = await this.get<Array<{ total_amount: number }>>('orders', Object.fromEntries(params));

    const totalRevenue = raw.reduce((sum, order) => sum + (order.total_amount || 0), 0);
    const totalOrders = raw.length;
    const averageOrderValue = totalOrders > 0 ? totalRevenue / totalOrders : 0;

    return { totalRevenue, totalOrders, averageOrderValue };
  }
}

// =============================================================================
// Raw Types (API response shape)
// =============================================================================

interface RawShippingMethod {
  id: string;
  name: string;
  description?: string;
  price: number;
  estimated_days: string;
  carrier?: string;
  is_active: boolean;
}

interface RawAddress {
  id: string;
  first_name: string;
  last_name: string;
  company?: string;
  address1: string;
  address2?: string;
  city: string;
  state: string;
  postal_code: string;
  country: string;
  phone?: string;
  is_default: boolean;
}

interface RawCard {
  id: string;
  last_four: string;
  card_type: string;
  expiry_month: number;
  expiry_year: number;
  is_default: boolean;
}

interface RawCustomer {
  id: string;
  first_name: string;
  last_name: string;
  email?: string;
  phone?: string;
  loyalty_tier?: string;
  total_spent?: number;
  total_points?: number;
  order_count?: number;
}

interface RawOrder {
  id: string;
  order_number: string;
  status: string;
  total_amount: number;
  created_at: string;
  customers?: {
    first_name: string;
    last_name: string;
  };
}

// =============================================================================
// Transformers
// =============================================================================

function transformShippingMethod(raw: RawShippingMethod): ShippingMethod {
  return {
    id: raw.id,
    name: raw.name,
    description: raw.description,
    price: raw.price,
    estimatedDays: raw.estimated_days,
    carrier: raw.carrier,
    isActive: raw.is_active,
  };
}

function transformAddress(raw: RawAddress): SavedAddress {
  return {
    id: raw.id,
    firstName: raw.first_name,
    lastName: raw.last_name,
    company: raw.company,
    address1: raw.address1,
    address2: raw.address2,
    city: raw.city,
    state: raw.state,
    postalCode: raw.postal_code,
    country: raw.country,
    phone: raw.phone,
    isDefault: raw.is_default,
  };
}

function transformCard(raw: RawCard): SavedCard {
  return {
    id: raw.id,
    lastFour: raw.last_four,
    cardType: raw.card_type,
    expiryMonth: raw.expiry_month,
    expiryYear: raw.expiry_year,
    isDefault: raw.is_default,
  };
}

function transformCustomer(raw: RawCustomer): Customer {
  return {
    id: raw.id,
    firstName: raw.first_name,
    lastName: raw.last_name,
    email: raw.email,
    phone: raw.phone,
    loyaltyTier: raw.loyalty_tier,
    totalSpent: raw.total_spent,
    totalPoints: raw.total_points,
    orderCount: raw.order_count,
  };
}

function transformOrder(raw: RawOrder): Order {
  return {
    id: raw.id,
    orderNumber: raw.order_number,
    status: raw.status,
    totalAmount: raw.total_amount,
    createdAt: raw.created_at,
    customerName: raw.customers
      ? `${raw.customers.first_name} ${raw.customers.last_name}`.trim()
      : 'Guest',
  };
}
