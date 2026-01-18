/**
 * Auth Store - Single source of truth for authentication
 *
 * Provides centralized auth state with:
 * - Login/logout via Supabase Auth
 * - Token management (access/refresh)
 * - User profile and store info
 * - Session persistence to disk
 * - Subscription-based reactivity for React hooks
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { config } from '../config.js';
import type { User, StoreInfo, LocationInfo } from '../types.js';

// =============================================================================
// Types
// =============================================================================

export interface AuthPrefetchData {
  user: User | null;
  permissions: string[];
  storeSettings: {
    name: string;
    timezone: string;
    currency: string;
    taxRate: number;
  } | null;
  lastLogin: string | null;
}

export interface AuthStoreState {
  // Auth tokens
  accessToken: string | null;
  refreshToken: string | null;
  expiresAt: number | null;

  // User info
  user: User | null;

  // Store info - current selection
  storeId: string | null;
  storeName: string | null;
  role: string | null;

  // Multi-store support
  stores: StoreInfo[];
  locations: LocationInfo[];
  currentLocation: LocationInfo | null;

  // Prefetch data
  prefetchData: AuthPrefetchData | null;

  // Loading states
  isInitialized: boolean;
  isLoading: boolean;
  error: string | null;

  // Computed
  isAuthenticated: boolean;
}

// =============================================================================
// Constants
// =============================================================================

const AUTH_STORE_FILE = join(config.storageDir, 'auth.json');
const TOKEN_REFRESH_BUFFER = 5 * 60 * 1000; // 5 minutes before expiry

function ensureStorageDir(): void {
  mkdirSync(config.storageDir, { recursive: true });
}

// =============================================================================
// Auth Store Class
// =============================================================================

class AuthStore {
  private state: AuthStoreState = {
    accessToken: null,
    refreshToken: null,
    expiresAt: null,
    user: null,
    storeId: null,
    storeName: null,
    role: null,
    stores: [],
    locations: [],
    currentLocation: null,
    prefetchData: null,
    isInitialized: false,
    isLoading: false,
    error: null,
    isAuthenticated: false,
  };

  private listeners: Set<(state: AuthStoreState) => void> = new Set();

  // Cached snapshot for useSyncExternalStore - prevents infinite loops
  private cachedSnapshot: AuthStoreState | null = null;

  constructor() {
    this.loadFromStorage();
  }

  // ---------------------------------------------------------------------------
  // State Access
  // ---------------------------------------------------------------------------

  getState(): AuthStoreState {
    // Return cached snapshot if available (required for useSyncExternalStore)
    if (!this.cachedSnapshot) {
      this.cachedSnapshot = { ...this.state };
    }
    return this.cachedSnapshot;
  }

  isAuthenticated(): boolean {
    return !!(this.state.accessToken && this.state.storeId);
  }

  needsRefresh(): boolean {
    if (!this.state.expiresAt) return false;
    return this.state.expiresAt - Date.now() < TOKEN_REFRESH_BUFFER;
  }

  getAccessToken(): string | null {
    return this.state.accessToken;
  }

  getStoreId(): string | null {
    return this.state.storeId;
  }

  getUser(): User | null {
    return this.state.user;
  }

  getStoreName(): string | null {
    return this.state.storeName;
  }

  // ---------------------------------------------------------------------------
  // Auth Operations
  // ---------------------------------------------------------------------------

  /**
   * Login with email and password
   */
  async loginWithPassword(email: string, password: string): Promise<boolean> {
    this.setLoading(true);
    this.setError(null);

    try {
      // Step 1: Authenticate with Supabase
      const authResponse = await fetch(
        `${config.apiUrl}/auth/v1/token?grant_type=password`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'apikey': config.anonKey,
          },
          body: JSON.stringify({ email, password }),
        }
      );

      if (!authResponse.ok) {
        const error = await authResponse.text();
        this.setError('Invalid email or password');
        return false;
      }

      const authData = await authResponse.json();

      // Step 2: Set access token first (needed for API calls)
      this.state.accessToken = authData.access_token;

      // Step 3: Get ALL user's stores
      const stores = await this.fetchUserStores(authData.user.id);

      if (!stores.length) {
        this.setError('No store associated with this account');
        return false;
      }

      // Use first store by default
      const currentStore = stores[0];

      // Step 4: Fetch locations for current store
      const locations = await this.fetchStoreLocations(currentStore.storeId);
      const defaultLocation = locations.find(l => l.isDefault) || locations[0] || null;

      // Step 5: Update full state (access token already set above)
      this.state = {
        accessToken: authData.access_token,
        refreshToken: authData.refresh_token,
        expiresAt: Date.now() + (authData.expires_in * 1000),
        user: {
          id: authData.user.id,
          email: authData.user.email,
        },
        storeId: currentStore.storeId,
        storeName: currentStore.storeName,
        role: currentStore.role,
        stores,
        locations,
        currentLocation: defaultLocation,
        prefetchData: null,
        isInitialized: true,
        isLoading: false,
        error: null,
        isAuthenticated: true,
      };

      this.persist();
      this.notify();

      // Step 4: Auto-refresh token if needed
      this.scheduleTokenRefresh();

      return true;
    } catch (error) {
      this.setError('Login failed. Please try again.');
      return false;
    } finally {
      this.setLoading(false);
    }
  }

  /**
   * Set auth state directly (for external login flows)
   */
  setAuth(
    accessToken: string,
    refreshToken: string,
    expiresAt: number,
    user: User,
    storeInfo: StoreInfo
  ): void {
    this.state = {
      ...this.state,
      accessToken,
      refreshToken,
      expiresAt,
      user,
      storeId: storeInfo.storeId,
      storeName: storeInfo.storeName,
      role: storeInfo.role,
      isInitialized: true,
      isLoading: false,
      error: null,
      isAuthenticated: true,
    };

    this.persist();
    this.notify();
    this.scheduleTokenRefresh();
  }

  /**
   * Refresh the access token
   */
  async refreshTokens(): Promise<boolean> {
    if (!this.state.refreshToken) {
      return false;
    }

    try {
      const response = await fetch(
        `${config.apiUrl}/auth/v1/token?grant_type=refresh_token`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'apikey': config.anonKey,
          },
          body: JSON.stringify({ refresh_token: this.state.refreshToken }),
        }
      );

      if (!response.ok) {
        // Refresh failed, user needs to re-login
        this.logout();
        return false;
      }

      const data = await response.json();

      this.state.accessToken = data.access_token;
      this.state.refreshToken = data.refresh_token;
      this.state.expiresAt = Date.now() + (data.expires_in * 1000);

      this.persist();
      this.notify();
      this.scheduleTokenRefresh();

      return true;
    } catch {
      return false;
    }
  }

  /**
   * Logout and clear all state
   */
  logout(): void {
    this.state = {
      accessToken: null,
      refreshToken: null,
      expiresAt: null,
      user: null,
      storeId: null,
      storeName: null,
      role: null,
      stores: [],
      locations: [],
      currentLocation: null,
      prefetchData: null,
      isInitialized: true,
      isLoading: false,
      error: null,
      isAuthenticated: false,
    };

    this.persist();
    this.notify();
  }

  /**
   * Switch to a different store
   */
  async switchStore(storeId: string): Promise<boolean> {
    const store = this.state.stores.find(s => s.storeId === storeId);
    if (!store) {
      return false;
    }

    // Fetch locations for the new store
    const locations = await this.fetchStoreLocations(storeId);
    const defaultLocation = locations.find(l => l.isDefault) || locations[0] || null;

    this.state.storeId = store.storeId;
    this.state.storeName = store.storeName;
    this.state.role = store.role;
    this.state.locations = locations;
    this.state.currentLocation = defaultLocation;
    this.state.prefetchData = null; // Clear prefetch on store change

    this.persist();
    this.notify();
    return true;
  }

  /**
   * Set the current location
   */
  setLocation(locationId: string | null): boolean {
    if (locationId === null) {
      this.state.currentLocation = null;
      this.persist();
      this.notify();
      return true;
    }

    const location = this.state.locations.find(l => l.id === locationId);
    if (!location) {
      return false;
    }

    this.state.currentLocation = location;
    this.persist();
    this.notify();
    return true;
  }

  /**
   * Get all stores
   */
  getStores(): StoreInfo[] {
    return this.state.stores;
  }

  /**
   * Get all locations for current store
   */
  getLocations(): LocationInfo[] {
    return this.state.locations;
  }

  /**
   * Get current location
   */
  getCurrentLocation(): LocationInfo | null {
    return this.state.currentLocation;
  }

  /**
   * Refresh stores and locations (used for migration from old auth format)
   */
  async refreshStoresAndLocations(): Promise<void> {
    if (!this.state.user?.id) return;

    try {
      // Fetch all stores for user
      const stores = await this.fetchUserStores(this.state.user.id);
      if (stores.length > 0) {
        this.state.stores = stores;
      }

      // Fetch locations for current store
      if (this.state.storeId) {
        const locations = await this.fetchStoreLocations(this.state.storeId);
        this.state.locations = locations;
        // Set default location if none selected
        if (!this.state.currentLocation && locations.length > 0) {
          this.state.currentLocation = locations.find(l => l.isDefault) || locations[0];
        }
      }

      this.persist();
      this.notify();
    } catch {
      // Silent fail - will retry on next login
    }
  }

  // ---------------------------------------------------------------------------
  // Helper Methods
  // ---------------------------------------------------------------------------

  /**
   * Fetch ALL stores the user has access to
   */
  private async fetchUserStores(userId: string): Promise<StoreInfo[]> {
    try {
      // Use access token if available, otherwise fall back to service key
      // Use user's access token for authenticated requests
      const authToken = this.state.accessToken || config.anonKey;

      const response = await fetch(
        `${config.apiUrl}/rest/v1/users?auth_user_id=eq.${userId}&select=id,store_id,role,stores(id,store_name)`,
        {
          headers: {
            'apikey': config.anonKey,
            'Authorization': `Bearer ${authToken}`,
          },
        }
      );

      if (!response.ok) {
        return [];
      }

      const data = await response.json();
      if (!data.length) {
        return [];
      }

      // Map all store records
      return data
        .filter((record: any) => record.store_id)
        .map((record: any) => ({
          storeId: record.store_id,
          storeName: record.stores?.store_name || 'Unknown Store',
          role: record.role || 'user',
        }));
    } catch {
      return [];
    }
  }

  /**
   * Fetch locations for a store
   */
  private async fetchStoreLocations(storeId: string): Promise<LocationInfo[]> {
    try {
      // Use user's access token - service key should NOT be in client code
      const authToken = this.state.accessToken || config.anonKey;
      const response = await fetch(
        `${config.apiUrl}/rest/v1/locations?store_id=eq.${storeId}&is_active=eq.true&select=id,name,is_default&order=is_default.desc,name.asc`,
        {
          headers: {
            'apikey': config.anonKey,
            'Authorization': `Bearer ${authToken}`,
          },
        }
      );

      if (!response.ok) {
        return [];
      }

      const data = await response.json();
      return data.map((loc: any) => ({
        id: loc.id,
        name: loc.name,
        isDefault: loc.is_default || false,
      }));
    } catch {
      return [];
    }
  }

  private refreshTimeoutId: ReturnType<typeof setTimeout> | null = null;

  private scheduleTokenRefresh(): void {
    // Clear any existing timeout
    if (this.refreshTimeoutId) {
      clearTimeout(this.refreshTimeoutId);
    }

    if (!this.state.expiresAt) return;

    // Schedule refresh 5 minutes before expiry
    const refreshIn = this.state.expiresAt - Date.now() - TOKEN_REFRESH_BUFFER;

    if (refreshIn > 0) {
      this.refreshTimeoutId = setTimeout(() => {
        this.refreshTokens();
      }, refreshIn);
    } else if (this.state.refreshToken) {
      // Token already needs refresh
      this.refreshTokens();
    }
  }

  private setLoading(isLoading: boolean): void {
    this.state.isLoading = isLoading;
    this.notify();
  }

  private setError(error: string | null): void {
    this.state.error = error;
    this.state.isLoading = false;
    this.notify();
  }

  // ---------------------------------------------------------------------------
  // Prefetch
  // ---------------------------------------------------------------------------

  updatePrefetchData(prefetchData: AuthPrefetchData): void {
    this.state.prefetchData = prefetchData;
    this.persist();
    this.notify();
  }

  // ---------------------------------------------------------------------------
  // Persistence
  // ---------------------------------------------------------------------------

  private loadFromStorage(): void {
    try {
      if (!existsSync(AUTH_STORE_FILE)) {
        this.state.isInitialized = true;
        return;
      }

      const raw = readFileSync(AUTH_STORE_FILE, 'utf8');
      const stored = JSON.parse(raw);

      // Only restore if we have valid auth data
      if (stored.accessToken && stored.storeId) {
        // Migrate old format: if stores array is empty but we have storeId, create it
        let stores = stored.stores || [];
        if (stores.length === 0 && stored.storeId) {
          stores = [{
            storeId: stored.storeId,
            storeName: stored.storeName || 'Unknown Store',
            role: stored.role || 'user',
          }];
        }

        this.state = {
          accessToken: stored.accessToken,
          refreshToken: stored.refreshToken || null,
          expiresAt: stored.expiresAt || null,
          user: stored.user || null,
          storeId: stored.storeId,
          storeName: stored.storeName || null,
          role: stored.role || null,
          stores,
          locations: stored.locations || [],
          currentLocation: stored.currentLocation || null,
          prefetchData: stored.prefetchData || null,
          isInitialized: true,
          isLoading: false,
          error: null,
          isAuthenticated: true,
        };

        // If stores were migrated or locations are empty, fetch fresh data
        if (stored.stores?.length === 0 || !stored.stores) {
          this.refreshStoresAndLocations();
        }

        // Check if token needs refresh on startup
        if (this.needsRefresh() && this.state.refreshToken) {
          this.refreshTokens();
        } else {
          this.scheduleTokenRefresh();
        }
      } else {
        this.state.isInitialized = true;
      }
    } catch {
      this.state.isInitialized = true;
    }
  }

  private persist(): void {
    try {
      ensureStorageDir();

      // Only persist auth-related fields, not loading/error states
      const toPersist = {
        accessToken: this.state.accessToken,
        refreshToken: this.state.refreshToken,
        expiresAt: this.state.expiresAt,
        user: this.state.user,
        storeId: this.state.storeId,
        storeName: this.state.storeName,
        role: this.state.role,
        stores: this.state.stores,
        locations: this.state.locations,
        currentLocation: this.state.currentLocation,
        prefetchData: this.state.prefetchData,
      };

      writeFileSync(AUTH_STORE_FILE, JSON.stringify(toPersist, null, 2), {
        mode: 0o600, // Secure permissions
      });
    } catch (error) {
      console.error('Failed to persist auth state:', error);
    }
  }

  // ---------------------------------------------------------------------------
  // Subscriptions
  // ---------------------------------------------------------------------------

  subscribe(listener: (state: AuthStoreState) => void): () => void {
    this.listeners.add(listener);
    // Immediately call with current state
    listener(this.getState());
    return () => this.listeners.delete(listener);
  }

  private notify(): void {
    // Invalidate cached snapshot so getState() creates a new one
    this.cachedSnapshot = null;
    const state = this.getState();
    this.listeners.forEach((listener) => listener(state));
  }
}

// =============================================================================
// Singleton Export
// =============================================================================

export const authStore = new AuthStore();

// Convenience exports for non-React usage
export const getAuthState = () => authStore.getState();
export const isAuthenticated = () => authStore.isAuthenticated();
export const getAccessToken = () => authStore.getAccessToken();
export const getStoreId = () => authStore.getStoreId();
export const getStores = () => authStore.getStores();
export const getLocations = () => authStore.getLocations();
export const getCurrentLocation = () => authStore.getCurrentLocation();
export const switchStore = (storeId: string) => authStore.switchStore(storeId);
export const setLocation = (locationId: string | null) => authStore.setLocation(locationId);
