/**
 * POS Module
 *
 * Handles point-of-sale operations including:
 * - Location and register management
 * - POS sessions (open/close)
 * - Cash movements
 * - Customer queue
 * - Dejavoo terminal integration
 */

import { BaseClient, type ClientConfig } from './client.js';
import { DatabaseError } from './errors.js';

// =============================================================================
// Types
// =============================================================================

export interface Location {
  id: string;
  name: string;
  slug: string;
  address: string;
  city: string;
  state: string;
  zip: string;
  phone: string;
  isDefault: boolean;
  isActive: boolean;
  acceptsOnlineOrders: boolean;
  taxRate: number;
}

export interface Register {
  id: string;
  name: string;
  locationId: string;
  paymentProcessorId: string | null;
  isActive: boolean;
}

export interface PaymentProcessor {
  id: string;
  processorType: 'dejavoo' | 'authorizenet' | 'stripe' | 'square';
  processorName: string;
  locationId: string | null;
  isActive: boolean;
  isDefault: boolean;
  environment: 'sandbox' | 'production';
  // Dejavoo specific
  dejavooAuthkey?: string;
  dejavooTpn?: string;
}

export interface PosSession {
  id: string;
  registerId: string;
  userId: string;
  locationId: string;
  openedAt: string;
  closedAt: string | null;
  openingBalance: number;
  closingBalance: number | null;
  expectedBalance: number | null;
  status: 'open' | 'closed';
}

export interface CashMovement {
  id: string;
  sessionId: string;
  type: 'drop' | 'pickup' | 'adjustment';
  amount: number;
  notes?: string;
  createdAt: string;
}

export interface QueueEntry {
  id: string;
  cartId: string;
  customerId: string | null;
  customerName?: string;
  position: number;
  status: 'waiting' | 'serving' | 'completed';
  addedAt: string;
}

export interface DejavooPaymentRequest {
  amount: number;
  tipAmount?: number;
  orderId?: string;
  invoiceNumber?: string;
}

export interface DejavooPaymentResult {
  success: boolean;
  transactionId?: string;
  authCode?: string;
  cardType?: string;
  lastFour?: string;
  message?: string;
  error?: string;
}

// =============================================================================
// POS Client
// =============================================================================

export class PosClient extends BaseClient {
  constructor(config: ClientConfig) {
    super(config);
  }

  // ---------------------------------------------------------------------------
  // Locations
  // ---------------------------------------------------------------------------

  /**
   * Get all active locations
   */
  async getLocations(): Promise<Location[]> {
    const params = new URLSearchParams();
    params.append('select', '*');
    params.append('is_active', 'eq.true');
    params.append('order', 'name.asc');

    const raw = await this.get<RawLocation[]>('locations', Object.fromEntries(params));
    return raw.map(transformLocation);
  }

  /**
   * Get location by ID
   */
  async getLocation(locationId: string): Promise<Location> {
    const params = new URLSearchParams();
    params.append('select', '*');
    params.append('id', `eq.${locationId}`);

    const raw = await this.get<RawLocation[]>('locations', Object.fromEntries(params));

    if (!raw.length) {
      throw DatabaseError.notFound('Location', locationId);
    }

    return transformLocation(raw[0]);
  }

  // ---------------------------------------------------------------------------
  // Registers
  // ---------------------------------------------------------------------------

  /**
   * Get registers for a location
   */
  async getRegisters(locationId: string): Promise<Register[]> {
    const params = new URLSearchParams();
    params.append('select', '*');
    params.append('location_id', `eq.${locationId}`);
    params.append('is_active', 'eq.true');
    params.append('order', 'name.asc');

    const raw = await this.get<RawRegister[]>('registers', Object.fromEntries(params));
    return raw.map(transformRegister);
  }

  // ---------------------------------------------------------------------------
  // Payment Processors
  // ---------------------------------------------------------------------------

  /**
   * Get payment processor for location
   */
  async getPaymentProcessor(locationId: string): Promise<PaymentProcessor | null> {
    const params = new URLSearchParams();
    params.append('select', '*');
    params.append('location_id', `eq.${locationId}`);
    params.append('is_active', 'eq.true');

    try {
      const raw = await this.get<RawPaymentProcessor[]>('payment_processors', Object.fromEntries(params));
      return raw[0] ? transformPaymentProcessor(raw[0]) : null;
    } catch {
      return null;
    }
  }

  // ---------------------------------------------------------------------------
  // Sessions
  // ---------------------------------------------------------------------------

  /**
   * Open a new POS session
   */
  async openSession(
    registerId: string,
    userId: string,
    locationId: string,
    openingBalance: number
  ): Promise<PosSession> {
    // Check if register already has an open session
    const existingParams = new URLSearchParams();
    existingParams.append('register_id', `eq.${registerId}`);
    existingParams.append('status', 'eq.open');

    const existing = await this.get<RawPosSession[]>('pos_sessions', Object.fromEntries(existingParams));

    if (existing.length > 0) {
      throw new DatabaseError({
        code: 'CONFLICT' as any,
        message: 'Register already has an open session',
        retryable: false,
      });
    }

    const raw = await this.post<RawPosSession[]>('pos_sessions', {
      register_id: registerId,
      user_id: userId,
      location_id: locationId,
      opening_balance: openingBalance,
      status: 'open',
    });

    return transformPosSession(raw[0]);
  }

  /**
   * Get current open session for register
   */
  async getCurrentSession(registerId: string): Promise<PosSession | null> {
    const params = new URLSearchParams();
    params.append('select', '*');
    params.append('register_id', `eq.${registerId}`);
    params.append('status', 'eq.open');

    const raw = await this.get<RawPosSession[]>('pos_sessions', Object.fromEntries(params));
    return raw[0] ? transformPosSession(raw[0]) : null;
  }

  /**
   * Close a POS session
   */
  async closeSession(sessionId: string, closingBalance: number): Promise<PosSession> {
    const params = new URLSearchParams();
    params.append('id', `eq.${sessionId}`);

    const raw = await this.patch<RawPosSession[]>(
      'pos_sessions',
      {
        closed_at: new Date().toISOString(),
        closing_balance: closingBalance,
        status: 'closed',
      },
      Object.fromEntries(params)
    );

    return transformPosSession(raw[0]);
  }

  // ---------------------------------------------------------------------------
  // Cash Movements
  // ---------------------------------------------------------------------------

  /**
   * Record a cash movement (drop, pickup, adjustment)
   */
  async recordCashMovement(
    sessionId: string,
    type: 'drop' | 'pickup' | 'adjustment',
    amount: number,
    notes?: string
  ): Promise<CashMovement> {
    const raw = await this.post<RawCashMovement[]>('cash_movements', {
      session_id: sessionId,
      movement_type: type,
      amount,
      notes,
    });

    return transformCashMovement(raw[0]);
  }

  /**
   * Get cash movements for a session
   */
  async getCashMovements(sessionId: string): Promise<CashMovement[]> {
    const params = new URLSearchParams();
    params.append('select', '*');
    params.append('session_id', `eq.${sessionId}`);
    params.append('order', 'created_at.desc');

    const raw = await this.get<RawCashMovement[]>('cash_movements', Object.fromEntries(params));
    return raw.map(transformCashMovement);
  }

  // ---------------------------------------------------------------------------
  // Queue
  // ---------------------------------------------------------------------------

  /**
   * Get queue for a location
   */
  async getQueue(locationId: string): Promise<QueueEntry[]> {
    const params = new URLSearchParams();
    params.append('select', '*,customers(first_name,last_name)');
    params.append('location_id', `eq.${locationId}`);
    params.append('status', 'in.(waiting,serving)');
    params.append('order', 'position.asc');

    const raw = await this.get<RawQueueEntry[]>('location_queue', Object.fromEntries(params));
    return raw.map(transformQueueEntry);
  }

  /**
   * Add customer to queue
   */
  async addToQueue(locationId: string, cartId: string, customerId?: string): Promise<QueueEntry> {
    // Use edge function for atomic position assignment
    const result = await this.callFunction<{ id: string; position: number }>(
      'add_to_location_queue',
      {
        p_location_id: locationId,
        p_cart_id: cartId,
        p_customer_id: customerId || null,
      }
    );

    // Fetch the created entry
    const params = new URLSearchParams();
    params.append('id', `eq.${result.id}`);

    const raw = await this.get<RawQueueEntry[]>('location_queue', Object.fromEntries(params));
    return transformQueueEntry(raw[0]);
  }

  /**
   * Update queue entry status
   */
  async updateQueueStatus(queueId: string, status: 'waiting' | 'serving' | 'completed'): Promise<void> {
    const params = new URLSearchParams();
    params.append('id', `eq.${queueId}`);

    await this.patch('location_queue', { status }, Object.fromEntries(params));
  }

  /**
   * Remove from queue
   */
  async removeFromQueue(queueId: string): Promise<void> {
    const params = new URLSearchParams();
    params.append('id', `eq.${queueId}`);

    await this.delete('location_queue', Object.fromEntries(params));
  }

  // ---------------------------------------------------------------------------
  // POS Cart Creation
  // ---------------------------------------------------------------------------

  /**
   * Create a POS-specific cart
   */
  async createPosCart(locationId: string, customerId?: string): Promise<{ id: string }> {
    const raw = await this.post<Array<{ id: string }>>('carts', {
      location_id: locationId,
      customer_id: customerId || null,
      cart_type: 'pos',
      expires_at: new Date(Date.now() + 4 * 60 * 60 * 1000).toISOString(), // 4h
    });

    return { id: raw[0].id };
  }
}

// =============================================================================
// Raw Types (API response shape)
// =============================================================================

interface RawLocation {
  id: string;
  name: string;
  slug: string;
  address_line1: string;
  city: string;
  state: string;
  zip: string;
  phone: string;
  is_default: boolean;
  is_active: boolean;
  accepts_online_orders: boolean;
  tax_rate: number;
}

interface RawRegister {
  id: string;
  name: string;
  location_id: string;
  payment_processor_id: string | null;
  is_active: boolean;
}

interface RawPaymentProcessor {
  id: string;
  processor_type: string;
  processor_name: string;
  location_id: string | null;
  is_active: boolean;
  is_default: boolean;
  environment: string;
  dejavoo_authkey?: string;
  dejavoo_tpn?: string;
}

interface RawPosSession {
  id: string;
  register_id: string;
  user_id: string;
  location_id: string;
  opened_at: string;
  created_at?: string;
  closed_at: string | null;
  opening_balance: number;
  closing_balance: number | null;
  expected_balance: number | null;
  status: string;
}

interface RawCashMovement {
  id: string;
  session_id: string;
  movement_type: string;
  amount: number;
  notes?: string;
  created_at: string;
}

interface RawQueueEntry {
  id: string;
  cart_id: string;
  customer_id: string | null;
  position: number;
  status: string;
  created_at: string;
  customers?: {
    first_name: string;
    last_name: string;
  };
}

// =============================================================================
// Transformers
// =============================================================================

function transformLocation(raw: RawLocation): Location {
  return {
    id: raw.id,
    name: raw.name,
    slug: raw.slug,
    address: raw.address_line1,
    city: raw.city,
    state: raw.state,
    zip: raw.zip,
    phone: raw.phone,
    isDefault: raw.is_default,
    isActive: raw.is_active,
    acceptsOnlineOrders: raw.accepts_online_orders,
    taxRate: raw.tax_rate || 0.0825,
  };
}

function transformRegister(raw: RawRegister): Register {
  return {
    id: raw.id,
    name: raw.name,
    locationId: raw.location_id,
    paymentProcessorId: raw.payment_processor_id,
    isActive: raw.is_active,
  };
}

function transformPaymentProcessor(raw: RawPaymentProcessor): PaymentProcessor {
  return {
    id: raw.id,
    processorType: raw.processor_type as PaymentProcessor['processorType'],
    processorName: raw.processor_name,
    locationId: raw.location_id,
    isActive: raw.is_active,
    isDefault: raw.is_default,
    environment: raw.environment as PaymentProcessor['environment'],
    dejavooAuthkey: raw.dejavoo_authkey,
    dejavooTpn: raw.dejavoo_tpn,
  };
}

function transformPosSession(raw: RawPosSession): PosSession {
  return {
    id: raw.id,
    registerId: raw.register_id,
    userId: raw.user_id,
    locationId: raw.location_id,
    openedAt: raw.opened_at || raw.created_at || new Date().toISOString(),
    closedAt: raw.closed_at,
    openingBalance: raw.opening_balance,
    closingBalance: raw.closing_balance,
    expectedBalance: raw.expected_balance,
    status: raw.status as PosSession['status'],
  };
}

function transformCashMovement(raw: RawCashMovement): CashMovement {
  return {
    id: raw.id,
    sessionId: raw.session_id,
    type: raw.movement_type as CashMovement['type'],
    amount: raw.amount,
    notes: raw.notes,
    createdAt: raw.created_at,
  };
}

function transformQueueEntry(raw: RawQueueEntry): QueueEntry {
  return {
    id: raw.id,
    cartId: raw.cart_id,
    customerId: raw.customer_id,
    customerName: raw.customers
      ? `${raw.customers.first_name} ${raw.customers.last_name}`.trim()
      : undefined,
    position: raw.position,
    status: raw.status as QueueEntry['status'],
    addedAt: raw.created_at,
  };
}
