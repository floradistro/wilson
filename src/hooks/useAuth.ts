import { useState, useEffect, useCallback } from 'react';
import type { AuthState, User, StoreInfo } from '../types.js';
import { loadAuth, saveAuth, clearAuth } from '../services/storage.js';
import { refreshAccessToken } from '../services/api.js';

interface UseAuthReturn {
  isAuthenticated: boolean;
  isLoading: boolean;
  accessToken: string | null;
  storeId: string | null;
  storeName: string | null;
  user: User | null;
  login: (
    accessToken: string,
    refreshToken: string,
    expiresAt: number,
    user: User,
    storeInfo: StoreInfo
  ) => void;
  logout: () => void;
  refresh: () => Promise<boolean>;
}

export function useAuth(): UseAuthReturn {
  const [state, setState] = useState<AuthState>({
    accessToken: null,
    refreshToken: null,
    expiresAt: null,
    user: null,
    storeId: null,
    storeName: null,
    role: null,
  });
  const [isLoading, setIsLoading] = useState(true);

  // Load auth on mount
  useEffect(() => {
    const stored = loadAuth();
    if (stored && stored.accessToken && stored.storeId) {
      setState(stored);

      // Check if token needs refresh (5 min buffer)
      if (stored.expiresAt && stored.refreshToken) {
        const needsRefresh = stored.expiresAt - Date.now() < 5 * 60 * 1000;
        if (needsRefresh) {
          refreshAccessToken(stored.refreshToken).then((result) => {
            if (result) {
              const newState: AuthState = {
                ...stored,
                accessToken: result.accessToken,
                expiresAt: result.expiresAt,
              };
              setState(newState);
              saveAuth(newState);
            }
          });
        }
      }
    }
    setIsLoading(false);
  }, []);

  const login = useCallback((
    accessToken: string,
    refreshToken: string,
    expiresAt: number,
    user: User,
    storeInfo: StoreInfo
  ) => {
    const newState: AuthState = {
      accessToken,
      refreshToken,
      expiresAt,
      user,
      storeId: storeInfo.storeId,
      storeName: storeInfo.storeName,
      role: storeInfo.role,
    };
    setState(newState);
    saveAuth(newState);
  }, []);

  const logout = useCallback(() => {
    setState({
      accessToken: null,
      refreshToken: null,
      expiresAt: null,
      user: null,
      storeId: null,
      storeName: null,
      role: null,
    });
    clearAuth();
  }, []);

  const refresh = useCallback(async (): Promise<boolean> => {
    if (!state.refreshToken) return false;

    try {
      const result = await refreshAccessToken(state.refreshToken);
      if (result) {
        const newState: AuthState = {
          ...state,
          accessToken: result.accessToken,
          expiresAt: result.expiresAt,
        };
        setState(newState);
        saveAuth(newState);
        return true;
      }
    } catch {
      // Refresh failed, user needs to re-login
      logout();
    }

    return false;
  }, [state, logout]);

  return {
    isAuthenticated: !!(state.accessToken && state.storeId),
    isLoading,
    accessToken: state.accessToken,
    storeId: state.storeId,
    storeName: state.storeName,
    user: state.user,
    login,
    logout,
    refresh,
  };
}
