/**
 * Base Database Client
 *
 * Provides HTTP communication layer with:
 * - Automatic retry with exponential backoff
 * - Typed error handling
 * - Request/response logging (debug mode)
 * - Timeout management
 */

import { DatabaseError, isRetryableError } from './errors.js';

export interface ClientConfig {
  baseUrl: string;
  anonKey: string;
  accessToken: string;
  timeout?: number;
  maxRetries?: number;
  debug?: boolean;
}

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  params?: URLSearchParams | Record<string, string>;
  body?: unknown;
  headers?: Record<string, string>;
  timeout?: number;
  retries?: number;
}

const DEFAULT_TIMEOUT = 30000; // 30 seconds
const DEFAULT_MAX_RETRIES = 2;
const RETRY_DELAY_BASE = 1000; // 1 second

export class BaseClient {
  protected readonly baseUrl: string;
  protected readonly headers: Record<string, string>;
  protected readonly timeout: number;
  protected readonly maxRetries: number;
  protected readonly debug: boolean;

  constructor(config: ClientConfig) {
    this.baseUrl = `${config.baseUrl}/rest/v1`;
    this.headers = {
      'apikey': config.anonKey,
      'Authorization': `Bearer ${config.accessToken}`,
      'Content-Type': 'application/json',
    };
    this.timeout = config.timeout ?? DEFAULT_TIMEOUT;
    this.maxRetries = config.maxRetries ?? DEFAULT_MAX_RETRIES;
    this.debug = config.debug ?? false;
  }

  /**
   * Make an HTTP request with automatic retry and error handling
   */
  protected async request<T>(
    endpoint: string,
    options: RequestOptions = {}
  ): Promise<T> {
    const {
      method = 'GET',
      params,
      body,
      headers = {},
      timeout = this.timeout,
      retries = this.maxRetries,
    } = options;

    // Build URL with query params
    let url = `${this.baseUrl}/${endpoint}`;
    if (params) {
      const searchParams = params instanceof URLSearchParams
        ? params
        : new URLSearchParams(params);
      url = `${url}?${searchParams}`;
    }

    // Merge headers
    const requestHeaders: Record<string, string> = {
      ...this.headers,
      ...headers,
    };

    // Add return representation header for mutations
    if (method !== 'GET' && !requestHeaders['Prefer']) {
      requestHeaders['Prefer'] = 'return=representation';
    }

    // Build request options
    const requestOptions: RequestInit = {
      method,
      headers: requestHeaders,
    };

    if (body !== undefined) {
      requestOptions.body = JSON.stringify(body);
    }

    // Execute with retry
    return this.executeWithRetry<T>(url, requestOptions, endpoint, retries, timeout);
  }

  /**
   * Execute request with exponential backoff retry
   */
  private async executeWithRetry<T>(
    url: string,
    options: RequestInit,
    endpoint: string,
    retriesLeft: number,
    timeout: number
  ): Promise<T> {
    try {
      // Create abort controller for timeout
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeout);

      if (this.debug) {
        console.log(`[DB] ${options.method} ${endpoint}`);
      }

      const response = await fetch(url, {
        ...options,
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      // Handle error responses
      if (!response.ok) {
        const error = DatabaseError.fromHttpResponse(response, endpoint);

        // Retry if retryable and retries left
        if (error.retryable && retriesLeft > 0) {
          const delay = this.calculateRetryDelay(retriesLeft);
          if (this.debug) {
            console.log(`[DB] Retrying in ${delay}ms (${retriesLeft} left)`);
          }
          await this.sleep(delay);
          return this.executeWithRetry<T>(url, options, endpoint, retriesLeft - 1, timeout);
        }

        throw error;
      }

      // Handle empty responses (DELETE, etc.)
      const contentLength = response.headers.get('content-length');
      if (contentLength === '0' || response.status === 204) {
        return undefined as T;
      }

      // Parse JSON response
      const data = await response.json();

      if (this.debug) {
        const count = Array.isArray(data) ? data.length : 1;
        console.log(`[DB] ${options.method} ${endpoint} → ${count} result(s)`);
      }

      return data as T;
    } catch (error) {
      // Handle network/timeout errors
      if (error instanceof Error && !(error instanceof DatabaseError)) {
        const dbError = DatabaseError.fromNetworkError(error, endpoint);

        // Retry network errors
        if (isRetryableError(dbError) && retriesLeft > 0) {
          const delay = this.calculateRetryDelay(retriesLeft);
          if (this.debug) {
            console.log(`[DB] Network error, retrying in ${delay}ms`);
          }
          await this.sleep(delay);
          return this.executeWithRetry<T>(url, options, endpoint, retriesLeft - 1, timeout);
        }

        throw dbError;
      }

      throw error;
    }
  }

  /**
   * Calculate retry delay with exponential backoff
   */
  private calculateRetryDelay(retriesLeft: number): number {
    const attempt = this.maxRetries - retriesLeft;
    const delay = RETRY_DELAY_BASE * Math.pow(2, attempt);
    // Add jitter (±25%)
    const jitter = delay * 0.25 * (Math.random() * 2 - 1);
    return Math.round(delay + jitter);
  }

  /**
   * Sleep helper
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * GET request helper
   */
  protected get<T>(endpoint: string, params?: Record<string, string>): Promise<T> {
    return this.request<T>(endpoint, { method: 'GET', params });
  }

  /**
   * POST request helper
   */
  protected post<T>(endpoint: string, body: unknown): Promise<T> {
    return this.request<T>(endpoint, { method: 'POST', body });
  }

  /**
   * PATCH request helper
   */
  protected patch<T>(endpoint: string, body: unknown, params?: Record<string, string>): Promise<T> {
    return this.request<T>(endpoint, { method: 'PATCH', body, params });
  }

  /**
   * DELETE request helper
   */
  protected delete(endpoint: string, params?: Record<string, string>): Promise<void> {
    return this.request<void>(endpoint, { method: 'DELETE', params });
  }

  /**
   * Call an edge function
   */
  protected async callFunction<T>(functionName: string, body: unknown): Promise<T> {
    const url = this.baseUrl.replace('/rest/v1', `/functions/v1/${functionName}`);

    const response = await fetch(url, {
      method: 'POST',
      headers: this.headers,
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      throw DatabaseError.fromHttpResponse(response, `functions/${functionName}`);
    }

    return response.json();
  }
}
