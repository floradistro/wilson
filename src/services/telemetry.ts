/**
 * Telemetry Service - Sends execution data to backend
 *
 * Logs tool executions to lisa_tool_execution_log for central visibility
 */

import { config } from '../config.js';
import { authStore } from '../stores/authStore.js';

interface ToolExecutionEvent {
  tool_name: string;
  execution_time_ms: number;
  result_status: 'success' | 'error';
  error_message?: string;
  error_code?: string;
  was_cached?: boolean;
  was_parallel?: boolean;
  conversation_id?: string;
  message_id?: string;
}

// Queue for batching telemetry (reduces API calls)
let eventQueue: ToolExecutionEvent[] = [];
let flushTimeout: ReturnType<typeof setTimeout> | null = null;
const FLUSH_INTERVAL = 5000; // Flush every 5 seconds
const MAX_QUEUE_SIZE = 20; // Or when queue hits 20 events

/**
 * Record a tool execution event
 */
export function recordToolExecution(event: ToolExecutionEvent): void {
  eventQueue.push(event);

  // Flush immediately if queue is full
  if (eventQueue.length >= MAX_QUEUE_SIZE) {
    flushTelemetry();
    return;
  }

  // Schedule flush if not already scheduled
  if (!flushTimeout) {
    flushTimeout = setTimeout(flushTelemetry, FLUSH_INTERVAL);
  }
}

/**
 * Flush queued events to backend
 */
async function flushTelemetry(): Promise<void> {
  if (flushTimeout) {
    clearTimeout(flushTimeout);
    flushTimeout = null;
  }

  if (eventQueue.length === 0) return;

  const events = [...eventQueue];
  eventQueue = [];

  const storeId = authStore.getStoreId();
  const accessToken = authStore.getAccessToken();

  if (!storeId || !accessToken) {
    // Not authenticated, skip telemetry
    return;
  }

  try {
    // Batch insert into lisa_tool_execution_log
    const rows = events.map(e => ({
      store_id: storeId,
      tool_name: e.tool_name,
      execution_time_ms: e.execution_time_ms,
      result_status: e.result_status,
      error_message: e.error_message || null,
      error_code: e.error_code || null,
      was_cached: e.was_cached || false,
      was_parallel: e.was_parallel || false,
      conversation_id: e.conversation_id || null,
      message_id: e.message_id || null,
    }));

    await fetch(`${config.apiUrl}/rest/v1/lisa_tool_execution_log`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': config.anonKey,
        'Authorization': `Bearer ${accessToken}`,
        'Prefer': 'return=minimal',
      },
      body: JSON.stringify(rows),
    });
  } catch {
    // Silent fail - telemetry shouldn't break the app
    // Re-queue events for next attempt (up to a limit)
    if (eventQueue.length < MAX_QUEUE_SIZE * 2) {
      eventQueue = [...events, ...eventQueue];
    }
  }
}

/**
 * Force flush on shutdown (async - should be awaited)
 */
export async function flushTelemetrySync(): Promise<void> {
  if (eventQueue.length > 0) {
    await flushTelemetry();
  }
}

/**
 * Helper to wrap tool execution with telemetry
 */
export async function withTelemetry<T>(
  toolName: string,
  conversationId: string | undefined,
  fn: () => Promise<T>
): Promise<T> {
  const startTime = Date.now();

  try {
    const result = await fn();
    const executionTime = Date.now() - startTime;

    recordToolExecution({
      tool_name: toolName,
      execution_time_ms: executionTime,
      result_status: 'success',
      conversation_id: conversationId,
    });

    return result;
  } catch (error) {
    const executionTime = Date.now() - startTime;

    recordToolExecution({
      tool_name: toolName,
      execution_time_ms: executionTime,
      result_status: 'error',
      error_message: error instanceof Error ? error.message : 'Unknown error',
      conversation_id: conversationId,
    });

    throw error;
  }
}
