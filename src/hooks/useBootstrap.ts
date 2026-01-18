/**
 * Bootstrap Hook
 *
 * Automatically loads store configuration and prefetch data
 * after user authentication. Handles caching and refresh.
 */

import { useState, useEffect, useCallback } from 'react';
import { bootstrapWilson, clearBootstrapCache, type BootstrapData } from '../services/bootstrap.js';

interface UseBootstrapReturn {
  bootstrap: BootstrapData | null;
  isLoading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

export function useBootstrap(
  accessToken: string | null,
  isAuthenticated: boolean
): UseBootstrapReturn {
  const [bootstrap, setBootstrap] = useState<BootstrapData | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Auto-load bootstrap data when authenticated
  useEffect(() => {
    if (!isAuthenticated || !accessToken) {
      setBootstrap(null);
      return;
    }

    loadBootstrap(accessToken, false);
  }, [isAuthenticated, accessToken]);

  const loadBootstrap = async (token: string, forceRefresh: boolean) => {
    setIsLoading(true);
    setError(null);

    try {
      const data = await bootstrapWilson(token, forceRefresh);

      if (data) {
        setBootstrap(data);
      }
      // If no data and no cache, that's okay - user will log in normally
    } catch (err) {
      // Suppress 401 errors - they're expected when not authenticated
      const errorMessage = err instanceof Error ? err.message : 'Bootstrap failed';
      if (!errorMessage.includes('401')) {
        setError(errorMessage);
      }
    } finally {
      setIsLoading(false);
    }
  };

  const refresh = useCallback(async () => {
    if (!accessToken) return;
    await loadBootstrap(accessToken, true);
  }, [accessToken]);

  // Clear cache on logout
  useEffect(() => {
    if (!isAuthenticated) {
      clearBootstrapCache();
      setBootstrap(null);
    }
  }, [isAuthenticated]);

  return {
    bootstrap,
    isLoading,
    error,
    refresh,
  };
}
