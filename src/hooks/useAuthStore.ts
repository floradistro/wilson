/**
 * useAuthStore - React hook that subscribes to authStore
 *
 * This hook provides reactive access to the auth store singleton.
 * Components will re-render when auth state changes.
 */

import { useEffect, useCallback, useSyncExternalStore } from 'react';
import { authStore, type AuthStoreState } from '../stores/authStore.js';
import { bootstrapWilson } from '../services/bootstrap.js';
import { createMcpClient, cleanupMcp } from '../services/mcp.js';
import { prefetchMcpTools, prebuildCodebaseIndex } from '../services/api.js';
import { fetchMenuConfig, clearMenuCache } from '../services/menu.js';
import type { StoreInfo, LocationInfo } from '../types.js';

// Stable references for useSyncExternalStore - must be defined outside component
const subscribe = (callback: () => void) => authStore.subscribe(callback);
const getSnapshot = () => authStore.getState();

interface UseAuthStoreReturn {
  // State
  isAuthenticated: boolean;
  isLoading: boolean;
  isInitialized: boolean;
  error: string | null;

  // User/Store info
  accessToken: string | null;
  storeId: string | null;
  storeName: string | null;
  user: { id: string; email: string } | null;
  role: string | null;

  // Multi-store support
  stores: StoreInfo[];
  locations: LocationInfo[];
  currentLocation: LocationInfo | null;

  // Actions
  login: (email: string, password: string) => Promise<boolean>;
  logout: () => void;
  refresh: () => Promise<boolean>;
  switchStore: (storeId: string) => Promise<boolean>;
  setLocation: (locationId: string | null) => boolean;
  refreshStores: () => Promise<void>;
}

export function useAuthStore(): UseAuthStoreReturn {
  // Subscribe to store changes using useSyncExternalStore
  // Uses stable references defined at module level to prevent infinite loops
  const state = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  // Login action - calls authStore, bootstraps and initializes MCP on success
  const login = useCallback(async (email: string, password: string): Promise<boolean> => {
    const success = await authStore.loginWithPassword(email, password);

    if (success) {
      // Bootstrap prefetch data after successful login
      const token = authStore.getAccessToken();
      const storeId = authStore.getStoreId();
      if (token) {
        bootstrapWilson(token).catch(() => {
          // Silent fail - prefetch is optional
        });
      }
      // Initialize MCP client and prefetch tools for chart rendering
      if (storeId) {
        createMcpClient({ storeId })
          .then(() => prefetchMcpTools())
          .catch((err) => {
            console.error('[LOGIN] MCP initialization failed:', err?.message || err);
          });
        // Fetch menu config for this store
        fetchMenuConfig(storeId, token).catch(() => {});
      }
    }

    return success;
  }, []);

  // Logout action - cleanup MCP client
  const logout = useCallback(() => {
    cleanupMcp();
    authStore.logout();
  }, []);

  // Refresh token action
  const refresh = useCallback(async (): Promise<boolean> => {
    return authStore.refreshTokens();
  }, []);

  // Switch store action - reinitializes MCP for new store
  const switchStoreAction = useCallback(async (storeId: string): Promise<boolean> => {
    const success = await authStore.switchStore(storeId);
    if (success) {
      // Reinitialize MCP client for new store
      cleanupMcp();
      createMcpClient({ storeId })
        .then(() => prefetchMcpTools())
        .catch(() => {});
      // Re-bootstrap for new store
      const token = authStore.getAccessToken();
      if (token) {
        bootstrapWilson(token).catch(() => {});
      }
      // Refresh menu for new store
      clearMenuCache();
      fetchMenuConfig(storeId, token || undefined).catch(() => {});
    }
    return success;
  }, []);

  // Set location action
  const setLocationAction = useCallback((locationId: string | null): boolean => {
    return authStore.setLocation(locationId);
  }, []);

  // Refresh stores/locations
  const refreshStores = useCallback(async (): Promise<void> => {
    await authStore.refreshStoresAndLocations();
  }, []);

  // Pre-build codebase index on mount (runs once, regardless of auth)
  useEffect(() => {
    prebuildCodebaseIndex().catch(() => {});
  }, []);

  // Bootstrap and initialize MCP on mount if already authenticated
  useEffect(() => {
    if (state.isAuthenticated && state.accessToken && state.storeId) {
      bootstrapWilson(state.accessToken).catch(() => {});
      // Initialize MCP client and prefetch tools for chart rendering
      createMcpClient({ storeId: state.storeId })
        .then(() => {
          // console.log('[AUTH] MCP client connected');
          return prefetchMcpTools();
        })
        .then(() => {
          // console.log('[AUTH] MCP tools prefetched');
        })
        .catch((err) => {
          console.error('[AUTH] MCP initialization failed:', err?.message || err);
        });
      // Auto-refresh stores on startup to catch any changes
      authStore.refreshStoresAndLocations().catch(() => {});
      // Fetch menu config for current store
      fetchMenuConfig(state.storeId, state.accessToken || undefined).catch(() => {});
    }
  }, [state.isAuthenticated, state.accessToken, state.storeId]);

  return {
    // State
    isAuthenticated: state.isAuthenticated,
    isLoading: state.isLoading,
    isInitialized: state.isInitialized,
    error: state.error,

    // User/Store info
    accessToken: state.accessToken,
    storeId: state.storeId,
    storeName: state.storeName,
    user: state.user,
    role: state.role,

    // Multi-store support
    stores: state.stores,
    locations: state.locations,
    currentLocation: state.currentLocation,

    // Actions
    login,
    logout,
    refresh,
    switchStore: switchStoreAction,
    setLocation: setLocationAction,
    refreshStores,
  };
}
