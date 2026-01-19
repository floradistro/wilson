import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { config } from '../config.js';
import type { Message } from '../types.js';
import type { AIProvider } from '../providers/types.js';

// =============================================================================
// Auth Storage (for headless/worker modes)
// =============================================================================

const AUTH_STORE_FILE = join(config.storageDir, 'auth.json');

interface StoredAuth {
  accessToken: string | null;
  refreshToken: string | null;
  storeId: string | null;
  storeName: string | null;
  expiresAt: number | null;
}

/**
 * Load auth credentials from storage (for use in worker/validator modes)
 */
export function loadAuthFromStorage(): StoredAuth | null {
  try {
    if (existsSync(AUTH_STORE_FILE)) {
      const data = readFileSync(AUTH_STORE_FILE, 'utf8');
      const auth = JSON.parse(data);

      // Check if token is expired
      if (auth.expiresAt && Date.now() > auth.expiresAt) {
        return null;
      }

      return {
        accessToken: auth.accessToken || null,
        refreshToken: auth.refreshToken || null,
        storeId: auth.storeId || null,
        storeName: auth.storeName || null,
        expiresAt: auth.expiresAt || null,
      };
    }
  } catch {
    // Corrupted file
  }
  return null;
}

// =============================================================================
// Storage Paths
// =============================================================================

const SESSION_FILE = join(config.storageDir, 'session.json');

// Ensure storage directory exists
function ensureStorageDir(): void {
  if (!existsSync(config.storageDir)) {
    mkdirSync(config.storageDir, { recursive: true });
  }
}

// =============================================================================
// Session Storage
// =============================================================================

interface SessionState {
  conversationId: string | null;
  storeId: string | null;
  lastActivity: number;
  historyLength: number;
}

const SESSION_TIMEOUT = 30 * 60 * 1000; // 30 minutes

export function loadSession(): SessionState | null {
  try {
    if (existsSync(SESSION_FILE)) {
      const data = readFileSync(SESSION_FILE, 'utf8');
      const session = JSON.parse(data) as SessionState;

      // Check if session is still valid
      if (session.lastActivity && Date.now() - session.lastActivity < SESSION_TIMEOUT) {
        return session;
      }
    }
  } catch {
    // Corrupted file
  }
  return null;
}

export function saveSession(state: Partial<SessionState>): void {
  ensureStorageDir();

  const existing = loadSession() || {};
  const updated = {
    ...existing,
    ...state,
    lastActivity: Date.now(),
  };

  writeFileSync(SESSION_FILE, JSON.stringify(updated, null, 2));
}

export function clearSession(): void {
  ensureStorageDir();
  if (existsSync(SESSION_FILE)) {
    writeFileSync(SESSION_FILE, '{}');
  }
}

// =============================================================================
// History Storage (local backup)
// =============================================================================

const HISTORY_FILE = join(config.storageDir, 'history.json');

interface HistoryEntry {
  conversationId: string;
  messages: Array<{ role: string; content: string; timestamp: string }>;
}

export function loadLocalHistory(conversationId: string): Message[] {
  try {
    if (existsSync(HISTORY_FILE)) {
      const data = readFileSync(HISTORY_FILE, 'utf8');
      const histories = JSON.parse(data) as HistoryEntry[];
      const entry = histories.find(h => h.conversationId === conversationId);

      if (entry) {
        return entry.messages.map((m, i) => ({
          id: `${conversationId}-${i}`,
          role: m.role as 'user' | 'assistant',
          content: m.content,
          timestamp: new Date(m.timestamp),
        }));
      }
    }
  } catch {
    // Corrupted file
  }
  return [];
}

export function saveLocalHistory(conversationId: string, messages: Message[]): void {
  ensureStorageDir();

  let histories: HistoryEntry[] = [];

  try {
    if (existsSync(HISTORY_FILE)) {
      const data = readFileSync(HISTORY_FILE, 'utf8');
      histories = JSON.parse(data) as HistoryEntry[];
    }
  } catch {
    // Start fresh
  }

  // Update or add entry
  const existingIndex = histories.findIndex(h => h.conversationId === conversationId);
  const entry: HistoryEntry = {
    conversationId,
    messages: messages.slice(-50).map(m => ({
      role: m.role,
      content: m.content,
      timestamp: m.timestamp.toISOString(),
    })),
  };

  if (existingIndex >= 0) {
    histories[existingIndex] = entry;
  } else {
    histories.push(entry);
  }

  // Keep only last 10 conversations
  histories = histories.slice(-10);

  writeFileSync(HISTORY_FILE, JSON.stringify(histories, null, 2));
}

// =============================================================================
// AI Provider Settings
// =============================================================================

const PROVIDER_FILE = join(config.storageDir, 'provider.json');

export interface ProviderSettings {
  provider: AIProvider;
  model: string;
  // API keys are stored separately or in env vars
  anthropicApiKey?: string;
  geminiApiKey?: string;
  openaiApiKey?: string;
}

const DEFAULT_PROVIDER_SETTINGS: ProviderSettings = {
  provider: 'anthropic',
  model: 'claude-sonnet-4-20250514',
};

export function loadProviderSettings(): ProviderSettings {
  try {
    if (existsSync(PROVIDER_FILE)) {
      const data = readFileSync(PROVIDER_FILE, 'utf8');
      const settings = JSON.parse(data) as Partial<ProviderSettings>;
      return {
        ...DEFAULT_PROVIDER_SETTINGS,
        ...settings,
      };
    }
  } catch {
    // Corrupted file, use defaults
  }
  return DEFAULT_PROVIDER_SETTINGS;
}

export function saveProviderSettings(settings: Partial<ProviderSettings>): void {
  ensureStorageDir();

  const existing = loadProviderSettings();
  const updated = {
    ...existing,
    ...settings,
  };

  writeFileSync(PROVIDER_FILE, JSON.stringify(updated, null, 2));
}

export function getApiKeyForProvider(provider: AIProvider): string | undefined {
  // Check environment variables first
  switch (provider) {
    case 'anthropic':
      return process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_API_KEY;
    case 'gemini':
      return process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
    case 'openai':
      return process.env.OPENAI_API_KEY;
  }

  // Fall back to stored settings
  const settings = loadProviderSettings();
  switch (provider) {
    case 'anthropic':
      return settings.anthropicApiKey;
    case 'gemini':
      return settings.geminiApiKey;
    case 'openai':
      return settings.openaiApiKey;
  }
}
