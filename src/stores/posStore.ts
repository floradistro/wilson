/**
 * POS Store - Point of Sale session and terminal management
 *
 * Uses database module for CRUD operations.
 * Uses edge functions for Dejavoo terminal integration.
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { config } from '../config.js';
import { authStore } from './authStore.js';
import {
  createDatabase,
  type Location,
  type Register,
  type PosSession,
  type PaymentProcessor,
  type DejavooPaymentRequest,
  type DejavooPaymentResult,
  isDatabaseError,
} from '../services/database/index.js';

// =============================================================================
// Re-export Types
// =============================================================================

export type {
  Location,
  Register,
  PosSession,
  PaymentProcessor,
  DejavooPaymentRequest,
  DejavooPaymentResult,
} from '../services/database/index.js';

export interface PosStoreState {
  // Current session
  session: PosSession | null;
  location: Location | null;
  register: Register | null;
  paymentProcessor: PaymentProcessor | null;

  // Available options
  locations: Location[];
  registers: Register[];

  // UI state
  isLoading: boolean;
  error: string | null;
}

// =============================================================================
// Storage
// =============================================================================

const POS_STORE_FILE = join(config.storageDir, 'pos.json');

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
  body: Record<string, unknown>
): Promise<{ ok: true; data: T } | { ok: false; error: string }> {
  const accessToken = authStore.getAccessToken();

  if (!accessToken) {
    return { ok: false, error: 'Not authenticated' };
  }

  try {
    const response = await fetch(`${config.apiUrl}/functions/v1/${functionName}`, {
      method: 'POST',
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
// POS Store Class
// =============================================================================

class PosStore {
  private state: PosStoreState = {
    session: null,
    location: null,
    register: null,
    paymentProcessor: null,
    locations: [],
    registers: [],
    isLoading: false,
    error: null,
  };

  private listeners: Set<(state: PosStoreState) => void> = new Set();

  constructor() {
    this.loadFromStorage();
  }

  // ---------------------------------------------------------------------------
  // State Access
  // ---------------------------------------------------------------------------

  getState(): PosStoreState {
    return { ...this.state };
  }

  getSession(): PosSession | null {
    return this.state.session;
  }

  getLocation(): Location | null {
    return this.state.location;
  }

  getRegister(): Register | null {
    return this.state.register;
  }

  getLocations(): Location[] {
    return this.state.locations;
  }

  isSessionOpen(): boolean {
    return this.state.session?.status === 'open';
  }

  // ---------------------------------------------------------------------------
  // Location & Register Management
  // ---------------------------------------------------------------------------

  async loadLocations(): Promise<boolean> {
    const db = getDb();
    if (!db) return false;

    this.setLoading(true);

    try {
      this.state.locations = await db.pos.getLocations();
      this.persist();
      this.notify();
      return true;
    } catch (error) {
      if (isDatabaseError(error)) {
        this.setError(error.message);
      }
      return false;
    } finally {
      this.setLoading(false);
    }
  }

  async selectLocation(locationId: string): Promise<boolean> {
    const location = this.state.locations.find(l => l.id === locationId);
    if (!location) {
      this.setError('Location not found');
      return false;
    }

    this.state.location = location;
    this.state.register = null;
    this.state.session = null;

    // Load registers for this location
    await this.loadRegisters(locationId);

    // Load payment processor for this location
    await this.loadPaymentProcessor(locationId);

    this.persist();
    this.notify();
    return true;
  }

  async loadRegisters(locationId: string): Promise<boolean> {
    const db = getDb();
    if (!db) return false;

    try {
      this.state.registers = await db.pos.getRegisters(locationId);
      this.notify();
      return true;
    } catch {
      return false;
    }
  }

  async selectRegister(registerId: string): Promise<boolean> {
    const register = this.state.registers.find(r => r.id === registerId);
    if (!register) {
      this.setError('Register not found');
      return false;
    }

    this.state.register = register;
    this.persist();
    this.notify();
    return true;
  }

  // ---------------------------------------------------------------------------
  // Session Management
  // ---------------------------------------------------------------------------

  async openSession(openingBalance: number = 0): Promise<boolean> {
    const db = getDb();
    const userId = authStore.getState().user?.id;

    if (!db || !this.state.register || !this.state.location || !userId) {
      this.setError('Register and location must be selected');
      return false;
    }

    this.setLoading(true);

    try {
      this.state.session = await db.pos.openSession(
        this.state.register.id,
        userId,
        this.state.location.id,
        openingBalance
      );
      this.persist();
      this.notify();
      return true;
    } catch (error) {
      if (isDatabaseError(error)) {
        this.setError(error.message);
      } else {
        this.setError('Failed to open session');
      }
      return false;
    } finally {
      this.setLoading(false);
    }
  }

  async closeSession(closingBalance: number): Promise<boolean> {
    const db = getDb();

    if (!db || !this.state.session) {
      this.setError('No active session');
      return false;
    }

    this.setLoading(true);

    try {
      this.state.session = await db.pos.closeSession(
        this.state.session.id,
        closingBalance
      );
      this.persist();
      this.notify();
      return true;
    } catch (error) {
      if (isDatabaseError(error)) {
        this.setError(error.message);
      } else {
        this.setError('Failed to close session');
      }
      return false;
    } finally {
      this.setLoading(false);
    }
  }

  // ---------------------------------------------------------------------------
  // Payment Processor (Dejavoo)
  // ---------------------------------------------------------------------------

  async loadPaymentProcessor(locationId: string): Promise<boolean> {
    const db = getDb();
    if (!db) return false;

    try {
      this.state.paymentProcessor = await db.pos.getPaymentProcessor(locationId);
      this.notify();
      return true;
    } catch {
      return false;
    }
  }

  async processDejavooPayment(request: DejavooPaymentRequest): Promise<DejavooPaymentResult> {
    if (!this.state.paymentProcessor) {
      return { success: false, error: 'No payment processor configured' };
    }

    if (this.state.paymentProcessor.processorType !== 'dejavoo') {
      return { success: false, error: 'Payment processor is not Dejavoo' };
    }

    const result = await callEdgeFunction<{
      success: boolean;
      transaction_id?: string;
      auth_code?: string;
      card_type?: string;
      last_four?: string;
      message?: string;
      error?: string;
    }>('dejavoo-payment', {
      processor_id: this.state.paymentProcessor.id,
      amount: request.amount,
      tip_amount: request.tipAmount || 0,
      order_id: request.orderId,
      invoice_number: request.invoiceNumber,
    });

    if (!result.ok) {
      return { success: false, error: result.error };
    }

    if (result.data.success) {
      return {
        success: true,
        transactionId: result.data.transaction_id,
        authCode: result.data.auth_code,
        cardType: result.data.card_type,
        lastFour: result.data.last_four,
        message: result.data.message,
      };
    }

    return {
      success: false,
      error: result.data.error || 'Payment failed',
    };
  }

  // ---------------------------------------------------------------------------
  // Cash Operations
  // ---------------------------------------------------------------------------

  async recordCashDrop(amount: number, notes?: string): Promise<boolean> {
    const db = getDb();

    if (!db || !this.state.session) {
      this.setError('No active session');
      return false;
    }

    try {
      await db.pos.recordCashMovement(this.state.session.id, 'drop', amount, notes);
      return true;
    } catch {
      return false;
    }
  }

  async recordCashMovement(
    type: 'in' | 'out',
    amount: number,
    reason: string
  ): Promise<boolean> {
    const db = getDb();

    if (!db || !this.state.session) {
      this.setError('No active session');
      return false;
    }

    try {
      // Map 'in'/'out' to the database module's type
      const movementType = type === 'in' ? 'pickup' : 'drop';
      await db.pos.recordCashMovement(this.state.session.id, movementType, amount, reason);
      return true;
    } catch {
      return false;
    }
  }

  // ---------------------------------------------------------------------------
  // Internal Helpers
  // ---------------------------------------------------------------------------

  private setLoading(isLoading: boolean): void {
    this.state.isLoading = isLoading;
    this.notify();
  }

  private setError(error: string): void {
    this.state.error = error;
    this.notify();
  }

  clearError(): void {
    this.state.error = null;
    this.notify();
  }

  // ---------------------------------------------------------------------------
  // Persistence
  // ---------------------------------------------------------------------------

  private loadFromStorage(): void {
    try {
      if (!existsSync(POS_STORE_FILE)) {
        return;
      }

      const raw = readFileSync(POS_STORE_FILE, 'utf8');
      const stored = JSON.parse(raw);

      this.state.location = stored.location || null;
      this.state.register = stored.register || null;
      this.state.session = stored.session || null;
      this.state.locations = stored.locations || [];
      this.state.registers = stored.registers || [];
    } catch {
      // Ignore storage errors
    }
  }

  private persist(): void {
    try {
      ensureStorageDir();
      writeFileSync(
        POS_STORE_FILE,
        JSON.stringify({
          location: this.state.location,
          register: this.state.register,
          session: this.state.session,
          locations: this.state.locations,
          registers: this.state.registers,
        }, null, 2)
      );
    } catch {
      // Ignore storage errors
    }
  }

  // ---------------------------------------------------------------------------
  // Subscriptions
  // ---------------------------------------------------------------------------

  subscribe(listener: (state: PosStoreState) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notify(): void {
    const state = this.getState();
    this.listeners.forEach((listener) => listener(state));
  }
}

// =============================================================================
// Singleton Export
// =============================================================================

export const posStore = new PosStore();

// Convenience exports
export const getPosState = () => posStore.getState();
export const getLocation = () => posStore.getLocation();
export const getLocations = () => posStore.getLocations();
export const isSessionOpen = () => posStore.isSessionOpen();
export const selectLocation = (id: string) => posStore.selectLocation(id);
export const openSession = (balance?: number) => posStore.openSession(balance);
export const closeSession = (balance: number) => posStore.closeSession(balance);
export const processDejavooPayment = (req: DejavooPaymentRequest) => posStore.processDejavooPayment(req);
