/**
 * Wilson Bootstrap Service
 *
 * Handles automatic configuration loading from backend:
 * - Fetches store config and prefetch data
 * - Caches locally for offline use
 * - Auto-refreshes on expiry
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { config } from '../config.js';
import type {
  AuthPrefetchData,
  CartPrefetchData,
  CheckoutPrefetchData,
} from '../types.js';

export interface BootstrapData {
  store: {
    id: string;
    name: string;
    role: string;
  };
  config: Record<string, any>;
  prefetchData: {
    // Existing prefetch types
    top_products?: any;
    inventory_summary?: any;
    sales_summary?: any;
    // New store prefetch types
    auth?: AuthPrefetchData;
    cart?: CartPrefetchData;
    checkout?: CheckoutPrefetchData;
  };
  features: Record<string, boolean>;
  session: {
    id: string;
    expiresAt: string;
  };
  // Metadata
  fetchedAt: number;
  expiresAt: number;
}

const BOOTSTRAP_CACHE_FILE = join(config.storageDir, 'bootstrap.json');
const CACHE_DURATION = 15 * 60 * 1000; // 15 minutes

/**
 * Bootstrap Wilson with configuration from backend
 * Uses cached data if available and not expired
 */
export async function bootstrapWilson(
  accessToken: string,
  forceRefresh = false
): Promise<BootstrapData | null> {
  // Check cache first (unless force refresh)
  if (!forceRefresh) {
    const cached = loadCachedBootstrap();
    if (cached && cached.expiresAt > Date.now()) {
      return cached;
    }
  }

  // Fetch fresh data from backend
  try {
    const response = await fetch(
      `${config.apiUrl}/functions/v1/wilson-bootstrap`,
      {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'apikey': config.anonKey,
          'x-client-info': 'wilson-cli',
          'x-platform': process.platform,
        },
      }
    );

    if (!response.ok) {
      const text = await response.text();
      // Don't log 401 errors - they're expected when not authenticated
      if (response.status !== 401) {
        console.error(`Bootstrap failed: ${response.status} - ${text}`);
      }
      throw new Error(`Bootstrap failed: ${response.status} - ${text}`);
    }

    const data = await response.json();

    if (!data.success) {
      throw new Error('Bootstrap unsuccessful');
    }

    // Build bootstrap data with metadata
    const bootstrap: BootstrapData = {
      store: data.store,
      config: data.config,
      prefetchData: data.prefetchData || {},
      features: data.features || {},
      session: data.session,
      fetchedAt: Date.now(),
      expiresAt: Date.now() + CACHE_DURATION,
    };

    // Cache for offline use
    cacheBootstrap(bootstrap);

    return bootstrap;
  } catch (error) {
    // Don't log 401 errors - they're expected when not authenticated
    const errorMessage = error instanceof Error ? error.message : String(error);
    if (!errorMessage.includes('401')) {
      console.error('Failed to bootstrap from backend:', error);
    }

    // Fall back to cached data if available
    const cached = loadCachedBootstrap();
    if (cached) {
      console.log('Using cached bootstrap data (offline mode)');
      return cached;
    }

    return null;
  }
}

/**
 * Load cached bootstrap data
 */
function loadCachedBootstrap(): BootstrapData | null {
  try {
    if (!existsSync(BOOTSTRAP_CACHE_FILE)) {
      return null;
    }

    const raw = readFileSync(BOOTSTRAP_CACHE_FILE, 'utf8');
    const data = JSON.parse(raw) as BootstrapData;

    return data;
  } catch {
    return null;
  }
}

/**
 * Save bootstrap data to cache
 */
function cacheBootstrap(data: BootstrapData): void {
  try {
    // Ensure directory exists
    mkdirSync(config.storageDir, { recursive: true });

    writeFileSync(BOOTSTRAP_CACHE_FILE, JSON.stringify(data, null, 2), 'utf8');
  } catch (error) {
    console.error('Failed to cache bootstrap data:', error);
  }
}

/**
 * Get prefetch data by type
 */
export function getPrefetchData(
  bootstrap: BootstrapData | null,
  type: string
): any {
  if (!bootstrap?.prefetchData) {
    return null;
  }

  return bootstrap.prefetchData[type as keyof typeof bootstrap.prefetchData];
}

/**
 * Check if a feature is enabled
 */
export function isFeatureEnabled(
  bootstrap: BootstrapData | null,
  feature: string
): boolean {
  return bootstrap?.features?.[feature] === true;
}

/**
 * Clear cached bootstrap data (for logout/reset)
 */
export function clearBootstrapCache(): void {
  try {
    if (existsSync(BOOTSTRAP_CACHE_FILE)) {
      writeFileSync(BOOTSTRAP_CACHE_FILE, '{}', 'utf8');
    }
  } catch {
    // Ignore errors
  }
}
