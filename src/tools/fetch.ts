import type { Tool, ToolResult } from '../types.js';
import { FetchSchema } from './schemas.js';
import { readFileSync, existsSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';

interface FetchParams {
  url: string;
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD' | 'OPTIONS';
  headers?: Record<string, string>;
  body?: string | Record<string, unknown>;
  timeout?: number;
  follow_redirects?: boolean;
}

const DEFAULT_TIMEOUT = 30000; // 30 seconds
const MAX_RESPONSE_SIZE = 500000; // 500KB

/**
 * HTTP Fetch tool for API testing and live data debugging.
 * Supports all HTTP methods, custom headers, JSON bodies, and response parsing.
 */
export const fetchTool: Tool = {
  schema: FetchSchema,

  async execute(params: Record<string, unknown>): Promise<ToolResult> {
    const {
      url,
      method = 'GET',
      headers = {},
      body,
      timeout = DEFAULT_TIMEOUT,
      follow_redirects = true,
    } = params as unknown as FetchParams;

    if (!url) {
      return { success: false, error: 'Missing url parameter' };
    }

    // Validate URL
    let parsedUrl: URL;
    try {
      parsedUrl = new URL(url);
    } catch {
      return { success: false, error: `Invalid URL: ${url}` };
    }

    // Build request options
    const requestHeaders: Record<string, string> = {
      'User-Agent': 'Wilson/1.0',
      ...headers,
    };

    // Auto-add Content-Type for JSON bodies
    let requestBody: string | undefined;
    if (body) {
      if (typeof body === 'object') {
        requestBody = JSON.stringify(body);
        if (!requestHeaders['Content-Type']) {
          requestHeaders['Content-Type'] = 'application/json';
        }
      } else {
        requestBody = body;
      }
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    try {
      const startTime = Date.now();

      const response = await fetch(url, {
        method,
        headers: requestHeaders,
        body: requestBody,
        signal: controller.signal,
        redirect: follow_redirects ? 'follow' : 'manual',
      });

      clearTimeout(timeoutId);
      const elapsed = Date.now() - startTime;

      // Get response headers
      const responseHeaders: Record<string, string> = {};
      response.headers.forEach((value, key) => {
        responseHeaders[key] = value;
      });

      // Get response body
      const contentType = response.headers.get('content-type') || '';
      let responseBody: string | Record<string, unknown>;

      const rawText = await response.text();

      // Truncate if too large
      const truncated = rawText.length > MAX_RESPONSE_SIZE;
      const text = truncated ? rawText.slice(0, MAX_RESPONSE_SIZE) : rawText;

      // Try to parse as JSON
      if (contentType.includes('application/json') || text.startsWith('{') || text.startsWith('[')) {
        try {
          responseBody = JSON.parse(text);
        } catch {
          responseBody = text;
        }
      } else {
        responseBody = text;
      }

      // Format the result
      const result = {
        status: response.status,
        statusText: response.statusText,
        ok: response.ok,
        url: response.url,
        elapsed_ms: elapsed,
        headers: responseHeaders,
        body: responseBody,
        truncated,
      };

      // Pretty format for display
      const summary = [
        `${method} ${parsedUrl.pathname}${parsedUrl.search}`,
        `Status: ${response.status} ${response.statusText}`,
        `Time: ${elapsed}ms`,
        `Size: ${rawText.length} bytes${truncated ? ' (truncated)' : ''}`,
      ].join('\n');

      return {
        success: response.ok,
        content: JSON.stringify(result, null, 2),
        summary,
      };
    } catch (error) {
      clearTimeout(timeoutId);

      if (error instanceof Error) {
        if (error.name === 'AbortError') {
          return { success: false, error: `Request timed out after ${timeout}ms` };
        }
        return { success: false, error: error.message };
      }

      return { success: false, error: 'Unknown fetch error' };
    }
  },
};

/**
 * Load auth token from ~/.wilson/auth.json
 */
function loadAuthToken(): string | null {
  try {
    const authPath = join(homedir(), '.wilson', 'auth.json');
    if (existsSync(authPath)) {
      const auth = JSON.parse(readFileSync(authPath, 'utf-8'));
      return auth.accessToken || null;
    }
  } catch {
    // Ignore errors
  }
  return null;
}

/**
 * Convenience tool for testing Supabase endpoints specifically.
 * Auto-injects auth headers using user's session token.
 */
export const supabaseFetchTool: Tool = {
  schema: {
    name: 'SupabaseFetch',
    description: 'Fetch data from Supabase REST API. Uses your auth session for proper permissions.',
    parameters: {
      type: 'object',
      properties: {
        table: { type: 'string', description: 'Table name to query' },
        select: { type: 'string', description: 'Columns to select (default: *)' },
        filter: { type: 'string', description: 'Filter string like "id=eq.123" or "status=eq.active"' },
        limit: { type: 'number', description: 'Max rows (default: 10)' },
        order: { type: 'string', description: 'Order by column like "created_at.desc"' },
      },
      required: ['table'],
    },
  },

  async execute(params: Record<string, unknown>): Promise<ToolResult> {
    const {
      table,
      select = '*',
      filter,
      limit = 10,
      order,
    } = params as {
      table: string;
      select?: string;
      filter?: string;
      limit?: number;
      order?: string;
    };

    // Load Supabase config from environment or config file
    const apiUrl = process.env.WILSON_API_URL;
    const anonKey = process.env.WILSON_ANON_KEY;
    const serviceKey = process.env.WILSON_SERVICE_KEY;

    if (!apiUrl || !anonKey) {
      return {
        success: false,
        error: 'Missing Supabase configuration. Set WILSON_API_URL and WILSON_ANON_KEY.',
      };
    }

    // Try to get user's auth token for proper RLS access
    const authToken = loadAuthToken();

    // Use service key for full access, or auth token for user-scoped access
    const bearerToken = serviceKey || authToken || anonKey;

    // Build URL with query params
    const url = new URL(`${apiUrl}/rest/v1/${table}`);
    url.searchParams.set('select', select);

    // Parse filter properly (supports PostgREST filter syntax)
    if (filter) {
      // Handle filters like "status=eq.active" or "store_id=eq.uuid-here"
      const eqIndex = filter.indexOf('=');
      if (eqIndex > 0) {
        const key = filter.slice(0, eqIndex);
        const value = filter.slice(eqIndex + 1);
        url.searchParams.set(key, value);
      }
    }

    if (order) url.searchParams.set('order', order);
    url.searchParams.set('limit', String(limit));

    try {
      const response = await fetch(url.toString(), {
        headers: {
          'apikey': anonKey,
          'Authorization': `Bearer ${bearerToken}`,
          'Content-Type': 'application/json',
        },
      });

      const data = await response.json();

      if (!response.ok) {
        return {
          success: false,
          error: `Supabase error: ${JSON.stringify(data)}`,
        };
      }

      const rowCount = Array.isArray(data) ? data.length : 1;

      return {
        success: true,
        content: JSON.stringify(data, null, 2),
        summary: `${rowCount} row${rowCount !== 1 ? 's' : ''} from ${table}`,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Supabase fetch failed',
      };
    }
  },
};
