#!/usr/bin/env node
/**
 * Lisa CLI - A conversational interface to your business
 *
 * Inspired by Claude Code's clean, minimal design.
 */

import { createInterface, emitKeypressEvents } from "readline";
import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync, statSync, createReadStream } from "fs";
import { readFile, stat, readdir } from "fs/promises";
import { homedir } from "os";
import { join, dirname, basename, extname } from "path";
import { execSync, spawnSync, spawn } from "child_process";

// =============================================================================
// Configuration
// =============================================================================

const SUPABASE_URL = "https://uaednwpxursknmwdeejn.supabase.co";
const ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVhZWRud3B4dXJza25td2RlZWpuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjA5OTcyMzMsImV4cCI6MjA3NjU3MzIzM30.N8jPwlyCBB5KJB5I-XaK6m-mq88rSR445AWFJJmwRCg";
const SERVICE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVhZWRud3B4dXJza25td2RlZWpuIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2MDk5NzIzMywiZXhwIjoyMDc2NTczMjMzfQ.l0NvBbS2JQWPObtWeVD2M2LD866A2tgLmModARYNnbI";

const VERSION = "2.2.0";

// GitHub repository for updates (uses Releases API)
const GITHUB_REPO = "floradistro/pt";

// =============================================================================
// ANSI Codes (minimal set)
// =============================================================================

const RESET = "\x1b[0m";
const BOLD = "\x1b[1m";
const DIM = "\x1b[2m";

// Apple-inspired minimal palette
const WHITE = "\x1b[97m";               // Pure white - primary text
const GRAY = "\x1b[38;5;250m";          // Light gray - secondary text
const GRAY_DIM = "\x1b[38;5;245m";      // Medium gray - tertiary
const GRAY_DARK = "\x1b[38;5;240m";     // Dark gray - subtle
const BLUE = "\x1b[38;5;39m";           // Apple blue - accent, interactive
const GREEN = "\x1b[38;5;35m";          // Apple green - success, money
const GREEN_BRIGHT = "\x1b[38;5;46m";   // Bright green - emphasis
const RED = "\x1b[38;5;203m";           // Soft red - errors, negative
const ORANGE = "\x1b[38;5;215m";        // Soft orange - warnings
const GREEN_DIM = "\x1b[38;5;34m";      // For compatibility
const MAGENTA = "\x1b[38;5;165m";      // Magenta for bars
const CYAN = "\x1b[38;5;51m";          // Cyan accent

// =============================================================================
// Chart Rendering (stdout-based)
// =============================================================================

const SPARK = '▁▂▃▄▅▆▇█';

function fmt(n, isCurrency = false) {
  const prefix = isCurrency ? '$' : '';
  if (n >= 1e6) return prefix + (n / 1e6).toFixed(1) + 'M';
  if (n >= 1e3) return prefix + (n / 1e3).toFixed(1) + 'K';
  return prefix + Math.round(n).toLocaleString();
}

function sparkline(vals) {
  if (!vals?.length) return '';
  const min = Math.min(...vals), max = Math.max(...vals), r = max - min || 1;
  return vals.map(v => SPARK[Math.min(7, Math.floor(((v - min) / r) * 7))]).join('');
}

function renderBarChart(title, data, options = {}) {
  const isCurrency = options.isCurrency || /revenue|sales|amount|total/i.test(title);
  const max = Math.max(...data.map(d => d.value));
  const total = data.reduce((sum, d) => sum + d.value, 0);
  const labelW = Math.min(Math.max(...data.map(d => d.label.length), 8), 18);
  const lines = [];

  lines.push('');
  lines.push(`${WHITE}${BOLD}${title}${RESET}`);
  lines.push(`${GRAY_DARK}${'─'.repeat(55)}${RESET}`);

  data.slice(0, 8).forEach(({ label, value }) => {
    const w = Math.round((value / max) * 24);
    const displayLabel = label.length > labelW ? label.slice(0, labelW - 1) + '…' : label;
    const pct = total > 0 ? Math.round((value / total) * 100) : 0;
    lines.push(`${WHITE}${displayLabel.padEnd(labelW)}${RESET}  ${MAGENTA}${'█'.repeat(w)}${RESET} ${GREEN}${fmt(value, isCurrency)}${RESET} ${GRAY_DIM}(${pct}%)${RESET}`);
  });

  lines.push(`${GRAY_DARK}${'─'.repeat(55)}${RESET}`);
  lines.push(`${BOLD}${'Total'.padEnd(labelW)}${RESET}  ${' '.repeat(24)} ${BOLD}${GREEN}${fmt(total, isCurrency)}${RESET}`);

  return lines.join('\n');
}

function renderLineChart(title, data) {
  const vals = data.map(d => d.value);
  const spark = sparkline(vals);
  const first = vals[0], last = vals[vals.length - 1];
  const pct = first ? ((last - first) / first * 100).toFixed(1) : '0';
  const trend = last >= first ? `${GREEN}▲${RESET}` : `${RED}▼${RESET}`;
  const lines = [];

  lines.push('');
  lines.push(`${WHITE}${BOLD}${title}${RESET}`);
  lines.push(`${CYAN}${spark}${RESET}  ${trend} ${GRAY_DIM}${pct}%${RESET}`);
  lines.push(`${GRAY_DIM}${fmt(first)} → ${fmt(last)}${RESET}`);

  return lines.join('\n');
}

function renderDonutChart(title, data, options = {}) {
  const colors = [MAGENTA, CYAN, GREEN, ORANGE, BLUE];
  const isCurrency = options.isCurrency || /revenue|sales|amount/i.test(title);
  const total = data.reduce((a, d) => a + d.value, 0);
  const labelW = Math.min(Math.max(...data.map(d => d.label.length), 12), 16);
  const lines = [];

  lines.push('');
  lines.push(`${WHITE}${BOLD}${title}${RESET}`);
  lines.push(`${GRAY_DARK}${'─'.repeat(50)}${RESET}`);

  data.slice(0, 5).forEach((d, i) => {
    const pct = Math.round((d.value / total) * 100);
    const bar = '█'.repeat(Math.round(pct / 4));
    const displayLabel = d.label.length > labelW ? d.label.slice(0, labelW - 1) + '…' : d.label;
    lines.push(`${WHITE}${displayLabel.padEnd(labelW)}${RESET} ${colors[i]}${bar.padEnd(25)}${RESET} ${GREEN}${fmt(d.value, isCurrency)}${RESET} ${GRAY_DIM}(${pct}%)${RESET}`);
  });

  lines.push(`${GRAY_DARK}${'─'.repeat(50)}${RESET}`);
  lines.push(`${BOLD}${'Total'.padEnd(labelW)}${RESET} ${' '.repeat(25)} ${BOLD}${GREEN}${fmt(total, isCurrency)}${RESET}`);

  return lines.join('\n');
}

function renderTable(title, headers, rows) {
  const ws = headers.map((h, i) => Math.max(h.length, ...rows.map(r => String(r[i] || '').length), 4));
  const lines = [];

  lines.push('');
  lines.push(`${WHITE}${BOLD}${title}${RESET}`);
  lines.push(`${GRAY_DARK}${'─'.repeat(ws.reduce((a, b) => a + b + 3, 0))}${RESET}`);
  lines.push('  ' + headers.map((h, i) => `${BOLD}${h.padEnd(ws[i])}${RESET}`).join('   '));

  rows.slice(0, 6).forEach(row => {
    lines.push('  ' + row.map((c, i) => {
      const s = String(c || '');
      const color = s.startsWith('$') ? GREEN : s.startsWith('-') ? RED : GRAY;
      return `${color}${s.padEnd(ws[i])}${RESET}`;
    }).join('   '));
  });

  if (rows.length > 6) lines.push(`${GRAY_DIM}  +${rows.length - 6} more${RESET}`);

  return lines.join('\n');
}

function renderMetrics(title, metrics) {
  const lines = [];
  lines.push('');
  lines.push(`${WHITE}${BOLD}${title}${RESET}`);
  lines.push(`${GRAY_DARK}${'─'.repeat(40)}${RESET}`);

  metrics.forEach(m => {
    let line = `${GRAY}${m.label.padEnd(16)}${RESET} ${BOLD}${GREEN}${m.value}${RESET}`;
    if (m.change != null) {
      const arrow = m.change >= 0 ? '▲' : '▼';
      const color = m.change >= 0 ? GREEN : RED;
      line += `  ${color}${arrow} ${Math.abs(m.change).toFixed(1)}%${RESET}`;
    }
    lines.push(line);
  });

  return lines.join('\n');
}

function tryRenderChart(data, name) {
  if (!data) return null;

  // Handle explicit chart structure
  if (data.chart) {
    const c = data.chart;
    if (c.type === 'bar' && c.data) return renderBarChart(c.title || name, c.data);
    if (c.type === 'line' && c.data) return renderLineChart(c.title || name, c.data);
    if ((c.type === 'donut' || c.type === 'pie') && c.data) return renderDonutChart(c.title || name, c.data);
    if (c.type === 'table' && c.headers && c.rows) return renderTable(c.title || name, c.headers, c.rows);
    if (c.type === 'metrics' && c.data) return renderMetrics(c.title || name, c.data);
    return null;
  }

  // Auto-detect from data structure
  const rows = data.data || data.results || data.rows || (Array.isArray(data) ? data : null);
  if (!rows?.length || typeof rows[0] !== 'object') return null;

  const keys = Object.keys(rows[0]);
  const labelKey = keys.find(k => /name|label|category|product|date|day|month/i.test(k));
  const valueKey = keys.find(k => /^total_revenue$|^revenue$|^total_sales$|^sales$/i.test(k))
    || keys.find(k => /revenue|sales|amount/i.test(k))
    || keys.find(k => /^total$|^value$|^sum$/i.test(k))
    || keys.find(k => /count|qty|units|quantity/i.test(k));

  if (labelKey && valueKey) {
    const isCurrency = /revenue|sales|amount|total(?!_count)/i.test(valueKey);
    const chartData = rows.slice(0, 10).map(r => ({
      label: String(r[labelKey] || '').slice(0, 20),
      value: Number(String(r[valueKey]).replace(/[^0-9.-]/g, '')) || 0
    }));

    const prettyTitle = (name || 'Data').replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());

    if (/date|day|week|month/i.test(labelKey)) {
      return renderLineChart(prettyTitle, chartData);
    }
    return renderBarChart(prettyTitle, chartData, { isCurrency });
  }

  return null;
}

// =============================================================================
// Session & Auth
// =============================================================================

const LISA_DIR = join(homedir(), ".lisa");
const AUTH_FILE = join(LISA_DIR, "auth.json");
const SESSION_FILE = join(LISA_DIR, "session.json");
const CONFIG_FILE = join(LISA_DIR, "config.json");

// Default configuration
const DEFAULT_CONFIG = {
  version: VERSION,
  autoUpdate: true,
  updateChannel: "stable",  // "stable" or "latest"
  ui: {
    theme: "dark",
    colors: true,
    animations: true,
  },
  session: {
    timeout: 30 * 60 * 1000,  // 30 minutes
    historyLimit: 20,
  },
  debug: false,
};

function ensureDir() {
  if (!existsSync(LISA_DIR)) mkdirSync(LISA_DIR, { recursive: true });
}

// =============================================================================
// Configuration Management
// =============================================================================

function loadConfig() {
  ensureDir();
  try {
    if (existsSync(CONFIG_FILE)) {
      const config = JSON.parse(readFileSync(CONFIG_FILE, "utf8"));
      return { ...DEFAULT_CONFIG, ...config };
    }
  } catch {}
  return DEFAULT_CONFIG;
}

function saveConfig(config) {
  ensureDir();
  writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
}

function getConfig() {
  return loadConfig();
}

// =============================================================================
// OTA Update System
// =============================================================================

async function checkForUpdates(silent = true) {
  const config = loadConfig();
  if (!config.autoUpdate) return null;

  try {
    // Fetch latest release from GitHub API
    const res = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/releases/latest`, {
      signal: AbortSignal.timeout(5000),
      headers: {
        'Accept': 'application/vnd.github.v3+json',
        'User-Agent': 'Lisa-CLI'
      }
    });
    if (!res.ok) return null;

    const release = await res.json();
    const remoteVersion = release.tag_name.replace('v', '');

    if (compareVersions(remoteVersion, VERSION) > 0) {
      if (!silent) {
        console.log(`\n  ${BLUE}Update available:${RESET} ${VERSION} → ${remoteVersion}`);
        console.log(`  Run ${WHITE}lisa update${RESET} to install\n`);
      }
      return remoteVersion;
    }
  } catch {}
  return null;
}

function compareVersions(a, b) {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    if (pa[i] > pb[i]) return 1;
    if (pa[i] < pb[i]) return -1;
  }
  return 0;
}

async function performUpdate() {
  console.log(`\n  ${BLUE}Checking for updates...${RESET}`);

  try {
    // Fetch latest release from GitHub API
    const res = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/releases/latest`, {
      headers: {
        'Accept': 'application/vnd.github.v3+json',
        'User-Agent': 'Lisa-CLI'
      }
    });

    if (!res.ok) {
      console.log(`  ${RED}Failed to check for updates${RESET}\n`);
      return false;
    }

    const release = await res.json();
    const targetVersion = release.tag_name.replace('v', '');

    if (compareVersions(targetVersion, VERSION) <= 0) {
      console.log(`  ${GREEN}Already up to date${RESET} (${VERSION})\n`);
      return true;
    }

    console.log(`  Updating ${VERSION} → ${targetVersion}...`);

    // Find the lisa binary asset in the release
    const lisaAsset = release.assets.find(a => a.name === 'lisa');
    if (!lisaAsset) {
      console.log(`  ${RED}Binary not found in release${RESET}\n`);
      return false;
    }

    // Download new version from release asset
    const binaryRes = await fetch(lisaAsset.browser_download_url, {
      headers: {
        'Accept': 'application/octet-stream',
        'User-Agent': 'Lisa-CLI'
      }
    });

    if (!binaryRes.ok) {
      console.log(`  ${RED}Failed to download update${RESET}\n`);
      return false;
    }

    const newBinary = await binaryRes.text();
    const installPath = process.argv[1];

    // Write new version
    writeFileSync(installPath, newBinary);

    console.log(`  ${GREEN}Updated successfully!${RESET}`);
    console.log(`  Restart Lisa to use version ${targetVersion}\n`);
    return true;
  } catch (err) {
    console.log(`  ${RED}Update failed: ${err.message}${RESET}\n`);
    return false;
  }
}

function loadAuth() {
  try {
    if (existsSync(AUTH_FILE)) return JSON.parse(readFileSync(AUTH_FILE, "utf8"));
  } catch {}
  return null;
}

function saveAuth(data) {
  ensureDir();
  writeFileSync(AUTH_FILE, JSON.stringify(data, null, 2));
}

function clearAuth() {
  ensureDir();
  if (existsSync(AUTH_FILE)) writeFileSync(AUTH_FILE, "{}");
}

function loadSession() {
  try {
    if (existsSync(SESSION_FILE)) {
      const data = JSON.parse(readFileSync(SESSION_FILE, "utf8"));
      if (Date.now() - data.lastActive < 30 * 60 * 1000) return data;
    }
  } catch {}
  return null;
}

function saveSession(data) {
  ensureDir();
  writeFileSync(SESSION_FILE, JSON.stringify({ ...data, lastActive: Date.now() }, null, 2));
}

function clearSession() {
  ensureDir();
  writeFileSync(SESSION_FILE, JSON.stringify({ lastActive: Date.now() }, null, 2));
}

// =============================================================================
// Auth Functions
// =============================================================================

async function signIn(email, password) {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "apikey": ANON_KEY },
    body: JSON.stringify({ email, password }),
  });
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.error_description || "Login failed");
  }
  const data = await res.json();
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    user: data.user,
    expiresAt: Date.now() + data.expires_in * 1000,
  };
}

async function refreshAuth(refreshToken) {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=refresh_token`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "apikey": ANON_KEY },
    body: JSON.stringify({ refresh_token: refreshToken }),
  });
  if (!res.ok) throw new Error("Session expired. Run: lisa login");
  const data = await res.json();
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    user: data.user,
    expiresAt: Date.now() + data.expires_in * 1000,
  };
}

async function getValidAuth() {
  const auth = loadAuth();
  if (!auth?.accessToken) return null;
  if (auth.expiresAt && Date.now() > auth.expiresAt - 300000) {
    try {
      const newAuth = await refreshAuth(auth.refreshToken);
      const full = { ...auth, ...newAuth };
      saveAuth(full);
      return full;
    } catch { return null; }
  }
  return auth;
}

async function getUserStore(userId) {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/users?auth_user_id=eq.${userId}&select=id,store_id,role,stores(id,store_name)`,
    { headers: { "apikey": SERVICE_KEY, "Authorization": `Bearer ${SERVICE_KEY}` } }
  );
  if (!res.ok) return null;
  const data = await res.json();
  if (!data.length) return null;
  return {
    odooUserId: data[0].id,
    storeId: data[0].store_id,
    storeName: data[0].stores?.store_name,
    role: data[0].role,
  };
}

async function getStoreLocations(accessToken, storeId) {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/locations?store_id=eq.${storeId}&is_active=eq.true&select=id,name&order=name`,
    { headers: { "apikey": ANON_KEY, "Authorization": `Bearer ${accessToken}` } }
  );
  if (!res.ok) return [];
  return res.json();
}

// =============================================================================
// Conversation Functions
// =============================================================================

async function getOrCreateConversation(accessToken, storeId, locationId = null) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/get_or_create_lisa_conversation`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "apikey": ANON_KEY,
      "Authorization": `Bearer ${accessToken}`,
    },
    body: JSON.stringify({ p_store_id: storeId, p_chat_type: "ai", p_location_id: locationId }),
  });
  if (!res.ok) {
    const create = await fetch(`${SUPABASE_URL}/rest/v1/lisa_conversations`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "apikey": SERVICE_KEY,
        "Authorization": `Bearer ${SERVICE_KEY}`,
        "Prefer": "return=representation",
      },
      body: JSON.stringify({
        store_id: storeId,
        chat_type: "ai",
        title: `CLI Chat - ${new Date().toLocaleDateString()}`,
        location_id: locationId,
      }),
    });
    const data = await create.json();
    return data[0]?.id;
  }
  return res.json();
}

async function loadHistory(accessToken, conversationId, limit = 20) {
  // Use service key for reading history (RLS bypass for test tokens)
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/lisa_messages?conversation_id=eq.${conversationId}&select=role,content&order=created_at.desc&limit=${limit}`,
    { headers: { "apikey": SERVICE_KEY, "Authorization": `Bearer ${SERVICE_KEY}` } }
  );
  if (!res.ok) return [];
  const msgs = await res.json();
  return msgs.reverse();
}

async function saveMessage(accessToken, conversationId, role, content) {
  await fetch(`${SUPABASE_URL}/rest/v1/lisa_messages`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "apikey": ANON_KEY,
      "Authorization": `Bearer ${accessToken}`,
    },
    body: JSON.stringify({ conversation_id: conversationId, role, content }),
  });
}

// =============================================================================
// Session Context
// =============================================================================

let ctx = {
  auth: null,
  storeId: null,
  storeName: null,
  userId: null,
  userEmail: null,
  locationId: null,
  locationName: null,
  conversationId: null,
  history: [],

  // Current chat context - unified model
  // chatType: 'ai' (private Lisa), 'team' (location team chat)
  chatType: 'ai',
  chatName: 'Lisa',  // Display name for current chat

  // Backend-driven menu config (loaded on init)
  menuConfig: [],

  // Dangerous mode - skip permission prompts
  dangerouslySkipPermissions: false,
};

// =============================================================================
// Backend-Driven Menu
// =============================================================================

async function loadMenuConfig(storeId) {
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/cli_menu_config?store_id=eq.${storeId}&is_active=eq.true&order=sort_order.asc`,
      {
        headers: {
          "apikey": SERVICE_KEY,
          "Authorization": `Bearer ${SERVICE_KEY}`
        },
        signal: AbortSignal.timeout(5000)
      }
    );
    if (!res.ok) return [];
    return res.json();
  } catch {
    return [];
  }
}

// =============================================================================
// Local File Tools (Client-Side Execution)
// From lisa-blessed.js - tool schemas sent to backend
// =============================================================================

// Constants for advanced tools
const MAX_FILE_SIZE_FULL_READ = 5 * 1024 * 1024; // 5MB - files larger get sampled
const MAX_JSON_PREVIEW_RECORDS = 100;
const PARALLEL_FILE_BATCH = 10;

// Format bytes to human readable
function formatBytes(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  if (bytes < 1024 * 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  return (bytes / (1024 * 1024 * 1024)).toFixed(2) + ' GB';
}

// Parallel file stat collection
async function parallelStatFiles(paths) {
  const results = await Promise.all(
    paths.map(async (p) => {
      try {
        const s = await stat(p);
        return { path: p, size: s.size, isDir: s.isDirectory(), mtime: s.mtime, error: null };
      } catch (err) {
        return { path: p, error: err.message };
      }
    })
  );
  return results;
}

// Stream-read large JSON file and extract summary
async function streamJsonSummary(filePath, maxRecords = MAX_JSON_PREVIEW_RECORDS) {
  return new Promise((resolve) => {
    const results = { records: [], totalSize: 0, fields: new Set(), recordCount: 0, error: null };

    try {
      const stats = statSync(filePath);
      results.totalSize = stats.size;

      // For small files, just read directly
      if (stats.size < MAX_FILE_SIZE_FULL_READ) {
        const content = readFileSync(filePath, 'utf8');
        const data = JSON.parse(content);
        if (Array.isArray(data)) {
          results.recordCount = data.length;
          results.records = data.slice(0, maxRecords);
          if (data.length > 0) {
            Object.keys(data[0]).forEach(k => results.fields.add(k));
          }
        } else {
          results.records = [data];
          results.recordCount = 1;
          Object.keys(data).forEach(k => results.fields.add(k));
        }
        results.fields = Array.from(results.fields);
        resolve(results);
        return;
      }

      // For large files, stream and sample
      let buffer = '';
      let inArray = false;
      let depth = 0;
      let recordStart = -1;
      let recordsFound = 0;

      const stream = createReadStream(filePath, { encoding: 'utf8', highWaterMark: 64 * 1024 });

      stream.on('data', (chunk) => {
        if (recordsFound >= maxRecords) {
          stream.destroy();
          return;
        }

        buffer += chunk;

        // Quick parse for array of objects
        for (let i = 0; i < buffer.length && recordsFound < maxRecords; i++) {
          const char = buffer[i];
          if (char === '[' && !inArray) { inArray = true; continue; }
          if (!inArray) continue;

          if (char === '{') {
            if (depth === 0) recordStart = i;
            depth++;
          } else if (char === '}') {
            depth--;
            if (depth === 0 && recordStart >= 0) {
              try {
                const record = JSON.parse(buffer.slice(recordStart, i + 1));
                results.records.push(record);
                Object.keys(record).forEach(k => results.fields.add(k));
                recordsFound++;
              } catch {}
              recordStart = -1;
            }
          }
        }

        // Keep only unprocessed part
        if (recordStart >= 0) {
          buffer = buffer.slice(recordStart);
          recordStart = 0;
        } else {
          buffer = '';
        }
      });

      stream.on('end', () => {
        // Estimate total records based on file size and avg record size
        if (results.records.length > 0) {
          const avgRecordSize = results.totalSize / results.records.length * (results.records.length / maxRecords);
          results.recordCount = Math.round(results.totalSize / (avgRecordSize / results.records.length));
        }
        results.fields = Array.from(results.fields);
        resolve(results);
      });

      stream.on('error', (err) => {
        results.error = err.message;
        results.fields = Array.from(results.fields);
        resolve(results);
      });

    } catch (err) {
      results.error = err.message;
      results.fields = Array.from(results.fields);
      resolve(results);
    }
  });
}

// Parallel directory analysis - processes entire directory tree in parallel
async function analyzeDirectoryParallel(dirPath, options = {}) {
  const { maxDepth = 5, includeContent = true } = options;
  const startTime = Date.now();

  const results = {
    path: dirPath,
    totalSize: 0,
    fileCount: 0,
    dirCount: 0,
    files: [],
    subdirs: [],
    byExtension: {},
    bySize: { small: 0, medium: 0, large: 0, huge: 0 },
    largestFiles: [],
    jsonSummaries: {},
    errors: [],
    processingTimeMs: 0
  };

  // Recursive directory walker
  async function walkDir(currentPath, depth) {
    if (depth > maxDepth) return;

    try {
      const entries = await readdir(currentPath, { withFileTypes: true });
      const files = [];
      const dirs = [];

      for (const entry of entries) {
        if (entry.name.startsWith('.')) continue; // Skip hidden
        const fullPath = join(currentPath, entry.name);

        if (entry.isDirectory()) {
          dirs.push(fullPath);
          results.dirCount++;
        } else if (entry.isFile()) {
          files.push(fullPath);
        }
      }

      // Process files in parallel batches
      for (let i = 0; i < files.length; i += PARALLEL_FILE_BATCH) {
        const batch = files.slice(i, i + PARALLEL_FILE_BATCH);
        const stats = await parallelStatFiles(batch);

        for (const s of stats) {
          if (s.error) {
            results.errors.push({ path: s.path, error: s.error });
            continue;
          }

          results.fileCount++;
          results.totalSize += s.size;

          const ext = extname(s.path).toLowerCase() || '(no ext)';
          results.byExtension[ext] = (results.byExtension[ext] || { count: 0, size: 0 });
          results.byExtension[ext].count++;
          results.byExtension[ext].size += s.size;

          // Categorize by size
          if (s.size < 100 * 1024) results.bySize.small++;
          else if (s.size < 1024 * 1024) results.bySize.medium++;
          else if (s.size < 50 * 1024 * 1024) results.bySize.large++;
          else results.bySize.huge++;

          // Track largest files
          results.largestFiles.push({ path: s.path, size: s.size, name: basename(s.path) });

          const relPath = s.path.replace(dirPath, '').replace(/^\//, '');
          results.files.push({ name: basename(s.path), path: relPath, size: s.size, ext });
        }
      }

      // Store subdirs
      for (const d of dirs) {
        const relPath = d.replace(dirPath, '').replace(/^\//, '');
        results.subdirs.push({ name: basename(d), path: relPath });
      }

      // Recurse into subdirs in parallel
      await Promise.all(dirs.map(d => walkDir(d, depth + 1)));

    } catch (err) {
      results.errors.push({ path: currentPath, error: err.message });
    }
  }

  await walkDir(dirPath, 0);

  // Sort and limit largest files
  results.largestFiles.sort((a, b) => b.size - a.size);
  results.largestFiles = results.largestFiles.slice(0, 10).map(f => ({
    ...f,
    sizeFormatted: formatBytes(f.size)
  }));

  // Process JSON files in parallel for summaries
  if (includeContent) {
    const jsonFiles = results.files
      .filter(f => f.ext === '.json')
      .sort((a, b) => b.size - a.size)
      .slice(0, 10); // Top 10 largest JSON files

    const jsonPromises = jsonFiles.map(async (f) => {
      const fullPath = join(dirPath, f.path);
      const summary = await streamJsonSummary(fullPath);
      return { path: f.path, ...summary };
    });

    const jsonResults = await Promise.all(jsonPromises);
    for (const jr of jsonResults) {
      if (jr.records.length > 0) {
        results.jsonSummaries[jr.path] = {
          fields: jr.fields,
          recordCount: jr.recordCount,
          sampleRecords: jr.records.slice(0, 3),
          totalSize: jr.totalSize
        };
      }
    }
  }

  results.processingTimeMs = Date.now() - startTime;
  results.totalSizeFormatted = formatBytes(results.totalSize);

  return results;
}

const LOCAL_TOOLS = [
  {
    name: "Read",
    description: "Read a file from the filesystem. Returns content with line numbers. Can read text files, images, PDFs, and Jupyter notebooks.",
    parameters: {
      type: "object",
      properties: {
        file_path: { type: "string", description: "Absolute path to the file to read" },
        offset: { type: "number", description: "Line number to start reading from (1-indexed)" },
        limit: { type: "number", description: "Number of lines to read (default: 2000)" }
      },
      required: ["file_path"]
    }
  },
  {
    name: "Edit",
    description: "Edit a file by replacing exact text. The old_string must be unique in the file unless using replace_all.",
    parameters: {
      type: "object",
      properties: {
        file_path: { type: "string", description: "Absolute path to the file to modify" },
        old_string: { type: "string", description: "The exact text to find and replace" },
        new_string: { type: "string", description: "The replacement text" },
        replace_all: { type: "boolean", description: "If true, replace ALL occurrences (default: false)" }
      },
      required: ["file_path", "old_string", "new_string"]
    }
  },
  {
    name: "Write",
    description: "Write content to a file. Creates parent directories if needed. Overwrites existing files.",
    parameters: {
      type: "object",
      properties: {
        file_path: { type: "string", description: "Absolute path to the file to write" },
        content: { type: "string", description: "Content to write to the file" }
      },
      required: ["file_path", "content"]
    }
  },
  {
    name: "Glob",
    description: "Find files matching a glob pattern. Supports ** for recursive matching. Returns files sorted by modification time.",
    parameters: {
      type: "object",
      properties: {
        pattern: { type: "string", description: "Glob pattern like '**/*.js' or 'src/**/*.ts'" },
        path: { type: "string", description: "Base directory to search in (default: cwd)" },
        type: { type: "string", description: "Filter: 'f' for files only, 'd' for directories only" },
        limit: { type: "number", description: "Maximum results (default: 100)" }
      },
      required: ["pattern"]
    }
  },
  {
    name: "Grep",
    description: "Search for regex patterns in files. Supports context lines and multiple output modes.",
    parameters: {
      type: "object",
      properties: {
        pattern: { type: "string", description: "Regex pattern to search for" },
        path: { type: "string", description: "File or directory to search (default: cwd)" },
        glob: { type: "string", description: "Filter files by glob, e.g. '*.js' or '*.{ts,tsx}'" },
        include: { type: "string", description: "File type filter: js, ts, py, go, rust, etc." },
        case_insensitive: { type: "boolean", description: "Case insensitive search" },
        context_before: { type: "number", description: "Lines before match (-B)" },
        context_after: { type: "number", description: "Lines after match (-A)" },
        context: { type: "number", description: "Lines before AND after (-C)" },
        output_mode: { type: "string", enum: ["content", "files", "count"], description: "'content'=lines, 'files'=paths only, 'count'=counts" },
        limit: { type: "number", description: "Max results (default: 50)" },
        multiline: { type: "boolean", description: "Multiline mode where . matches newlines" }
      },
      required: ["pattern"]
    }
  },
  {
    name: "Bash",
    description: "Execute a shell command. Use for git, npm, docker, etc. Avoid for file ops (use Read/Write/Edit).",
    parameters: {
      type: "object",
      properties: {
        command: { type: "string", description: "The bash command to execute" },
        cwd: { type: "string", description: "Working directory (default: cwd)" },
        timeout: { type: "number", description: "Timeout in ms (default: 120000, max: 600000)" },
        description: { type: "string", description: "Short description of what this command does" },
        background: { type: "boolean", description: "Run in background, return immediately" }
      },
      required: ["command"]
    }
  },
  {
    name: "LS",
    description: "List directory contents with file types and sizes.",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "Directory path to list" },
        all: { type: "boolean", description: "Include hidden files" },
        long: { type: "boolean", description: "Long format with sizes/dates" }
      },
      required: ["path"]
    }
  },
  {
    name: "Scan",
    description: "Analyze directory structure recursively. Returns tree with file counts and sizes.",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "Directory to analyze" },
        depth: { type: "number", description: "Max depth (default: 5)" },
        content: { type: "boolean", description: "Include file previews" },
        pattern: { type: "string", description: "Glob filter for files" }
      },
      required: ["path"]
    }
  },
  {
    name: "Peek",
    description: "Sample large JSON/JSONL files. Returns schema, samples, and optional aggregations.",
    parameters: {
      type: "object",
      properties: {
        file_path: { type: "string", description: "Path to JSON or JSONL file" },
        limit: { type: "number", description: "Records to sample (default: 100)" },
        aggregate: {
          type: "object",
          properties: {
            groupBy: { type: "string" },
            sumFields: { type: "array", items: { type: "string" } }
          }
        }
      },
      required: ["file_path"]
    }
  },
  {
    name: "Multi",
    description: "Read multiple files in parallel. More efficient than sequential Reads.",
    parameters: {
      type: "object",
      properties: {
        paths: { type: "array", items: { type: "string" }, description: "File paths to read" },
        lines: { type: "number", description: "Max lines per file (default: 500)" }
      },
      required: ["paths"]
    }
  },
  {
    name: "Sum",
    description: "Aggregate JSON files in a directory. Smart handling of COVA exports to avoid double-counting.",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "Directory or file path" },
        group: { type: "string", description: "Group by field (default: 'Product')" },
        fields: { type: "array", items: { type: "string" }, description: "Fields to sum" },
        top: { type: "number", description: "Top N results (default: 20)" },
        type: { type: "string", description: "'product', 'invoice', 'itemized', 'daily', or 'auto'" }
      },
      required: ["path"]
    }
  },
  {
    name: "TodoWrite",
    description: "Create and manage a task list. Use for complex multi-step tasks. Shows progress to user.",
    parameters: {
      type: "object",
      properties: {
        todos: {
          type: "array",
          items: {
            type: "object",
            properties: {
              content: { type: "string", description: "Task description (imperative form)" },
              status: { type: "string", enum: ["pending", "in_progress", "completed"], description: "Task status" }
            },
            required: ["content", "status"]
          },
          description: "Array of todo items"
        }
      },
      required: ["todos"]
    }
  },
  {
    name: "AskUser",
    description: "Ask the user a question when you need clarification or to make a decision.",
    parameters: {
      type: "object",
      properties: {
        question: { type: "string", description: "The question to ask" },
        options: {
          type: "array",
          items: { type: "string" },
          description: "Optional list of choices (user can also type a custom answer)"
        }
      },
      required: ["question"]
    }
  }
];

// =============================================================================
// Permission System (for dangerous operations)
// =============================================================================

const DANGEROUS_PATTERNS = [
  // Destructive file operations
  { pattern: /\brm\s+(-rf?|--force|-r)\s/i, desc: 'recursive/forced delete' },
  { pattern: /\brm\s+.*\*/i, desc: 'wildcard delete' },
  // Database operations
  { pattern: /\bDROP\s+(TABLE|DATABASE|INDEX|VIEW)/i, desc: 'DROP statement' },
  { pattern: /\bTRUNCATE\s+TABLE/i, desc: 'TRUNCATE statement' },
  { pattern: /\bDELETE\s+FROM\s+\w+\s*(;|$)/i, desc: 'DELETE without WHERE' },
  // Git operations
  { pattern: /\bgit\s+push\s+.*--force/i, desc: 'force push' },
  { pattern: /\bgit\s+reset\s+--hard/i, desc: 'hard reset' },
  // System operations
  { pattern: /\bsudo\s/i, desc: 'sudo command' },
  { pattern: /\bchmod\s+777/i, desc: 'chmod 777' },
];

async function checkDangerousOperation(command, toolName) {
  // Skip all checks if dangerously-skip-permissions is enabled
  if (ctx.dangerouslySkipPermissions) {
    return true;
  }

  for (const { pattern, desc } of DANGEROUS_PATTERNS) {
    if (pattern.test(command)) {
      process.stdout.write(`\n  ${ORANGE}!${RESET} ${WHITE}Dangerous operation detected:${RESET} ${desc}\n`);
      process.stdout.write(`  ${GRAY}Command: ${command.substring(0, 60)}${command.length > 60 ? '...' : ''}${RESET}\n`);

      // Exit raw mode for prompt
      if (process.stdin.isTTY && process.stdin.isRaw) {
        process.stdin.setRawMode(false);
      }

      return new Promise((resolve) => {
        const rl = createInterface({ input: process.stdin, output: process.stdout });
        rl.question(`  ${ORANGE}Allow?${RESET} (y/N): `, (answer) => {
          rl.close();
          // Re-enable raw mode
          if (process.stdin.isTTY) {
            process.stdin.setRawMode(true);
          }
          resolve(answer.toLowerCase() === 'y' || answer.toLowerCase() === 'yes');
        });
      });
    }
  }
  return true; // Safe by default
}

// Execute a local tool - returns structured result for backend
async function executeTool(name, params) {
  try {
    switch (name) {
      case "Read": {
        if (!params.file_path) return { success: false, error: 'Missing file_path' };
        const content = readFileSync(params.file_path, 'utf8');
        const lines = content.split('\n');
        const offset = Math.max(1, params.offset || 1);
        const limit = Math.min(2000, params.limit || 2000);
        const subset = lines.slice(offset - 1, offset - 1 + limit);
        return { success: true, content: subset.map((l, i) => `${String(offset + i).padStart(5)}  ${l}`).join('\n'), total_lines: lines.length };
      }
      case "Edit": {
        if (!params.file_path) return { success: false, error: 'Missing file_path' };
        const content = readFileSync(params.file_path, 'utf8');
        if (!content.includes(params.old_string)) return { success: false, error: 'String not found' };
        writeFileSync(params.file_path, params.replace_all ? content.split(params.old_string).join(params.new_string) : content.replace(params.old_string, params.new_string));
        return { success: true };
      }
      case "Write": {
        if (!params.file_path) return { success: false, error: 'Missing file_path' };
        const dir = dirname(params.file_path);
        if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
        writeFileSync(params.file_path, params.content);
        return { success: true };
      }
      case "Glob": {
        if (!params.pattern) return { success: false, error: 'Missing pattern' };
        const basePath = (params.path || process.cwd()).replace(/[`$();&|<>]/g, '');
        const limit = params.limit || 100;
        const typeFilter = params.type === 'd' ? '-type d' : params.type === 'f' ? '-type f' : '-type f';

        // Convert glob pattern to find command
        let findCmd;
        if (params.pattern.includes('**')) {
          // Recursive glob - use find with -name
          const filename = params.pattern.replace(/\*\*\//g, '').replace(/[`$();&|<>]/g, '');
          findCmd = `find "${basePath}" ${typeFilter} -name "${filename}" 2>/dev/null | head -${limit}`;
        } else if (params.pattern.includes('/')) {
          // Path-based pattern
          const parts = params.pattern.split('/');
          const filename = (parts.pop() || '*').replace(/[`$();&|<>]/g, '');
          const subdir = parts.join('/').replace(/[`$();&|<>]/g, '');
          const searchPath = subdir ? `${basePath}/${subdir}` : basePath;
          findCmd = `find "${searchPath}" ${typeFilter} -name "${filename}" 2>/dev/null | head -${limit}`;
        } else {
          // Simple filename pattern
          const filename = params.pattern.replace(/[`$();&|<>]/g, '');
          findCmd = `find "${basePath}" ${typeFilter} -name "${filename}" 2>/dev/null | head -${limit}`;
        }

        const output = execSync(findCmd, { encoding: 'utf8', timeout: 30000 });
        const files = output.trim().split('\n').filter(Boolean);
        return { success: true, files, count: files.length };
      }
      case "Grep": {
        if (!params.pattern) return { success: false, error: 'Missing pattern' };
        const safePath = (params.path || '.').replace(/[`$();&|<>]/g, '');
        const limit = params.limit || 50;

        // Build grep/rg command with all options
        let cmd = 'grep';
        let args = ['-rn']; // recursive, line numbers

        // Check if ripgrep is available (faster)
        try {
          execSync('which rg', { encoding: 'utf8' });
          cmd = 'rg';
          args = ['--line-number', '--no-heading'];
          if (params.glob) args.push('--glob', params.glob);
          if (params.include) args.push('--type', params.include);
          if (params.multiline) args.push('--multiline', '--multiline-dotall');
        } catch {
          // Fall back to grep
          if (params.glob) args.push(`--include=${params.glob}`);
        }

        if (params.case_insensitive) args.push('-i');

        // Context lines
        if (params.context) {
          args.push('-C', String(params.context));
        } else {
          if (params.context_before) args.push('-B', String(params.context_before));
          if (params.context_after) args.push('-A', String(params.context_after));
        }

        // Output mode
        if (params.output_mode === 'files') {
          args.push('-l'); // files only
        } else if (params.output_mode === 'count') {
          args.push('-c'); // count only
        }

        // Escape pattern for shell
        const safePattern = params.pattern.replace(/'/g, "'\\''");

        try {
          const fullCmd = `${cmd} ${args.join(' ')} -- '${safePattern}' "${safePath}" 2>/dev/null | head -${limit}`;
          const output = execSync(fullCmd, { encoding: 'utf8', timeout: 30000 });

          if (params.output_mode === 'files') {
            const files = output.trim().split('\n').filter(Boolean);
            return { success: true, files, count: files.length };
          } else if (params.output_mode === 'count') {
            return { success: true, counts: output.trim() };
          }
          return { success: true, matches: output };
        } catch { return { success: true, matches: '', files: [], count: 0 }; }
      }
      case "Bash": {
        if (!params.command) return { success: false, error: 'Missing command' };
        const cwd = params.cwd || process.cwd();
        const timeout = Math.min(params.timeout || 120000, 600000);

        // Check for dangerous operations
        const allowed = await checkDangerousOperation(params.command, 'Bash');
        if (!allowed) {
          return { success: false, error: 'Operation cancelled by user', cancelled: true };
        }

        if (params.background) {
          // Background execution - spawn and return immediately
          const child = spawn('bash', ['-c', params.command], {
            cwd,
            detached: true,
            stdio: 'ignore'
          });
          child.unref();
          return { success: true, background: true, pid: child.pid, message: `Started in background with PID ${child.pid}` };
        }

        const result = spawnSync('bash', ['-c', params.command], {
          cwd,
          encoding: 'utf8',
          timeout,
          maxBuffer: 10 * 1024 * 1024
        });
        return {
          success: result.status === 0,
          stdout: result.stdout || '',
          stderr: result.stderr || '',
          exit_code: result.status,
          description: params.description
        };
      }
      case "LS": {
        if (!params.path) return { success: false, error: 'Missing path' };
        const entries = readdirSync(params.path, { withFileTypes: true });
        const results = entries
          .filter(e => params.all || !e.name.startsWith('.'))
          .map(e => {
            const entry = { name: e.name, type: e.isDirectory() ? 'dir' : 'file' };
            if (params.long) {
              try {
                const stats = statSync(join(params.path, e.name));
                entry.size = stats.size;
                entry.modified = stats.mtime.toISOString();
              } catch {}
            }
            return entry;
          });
        return { success: true, entries: results, count: results.length };
      }

      case "Scan": {
        if (!params.path) return { success: false, error: 'Missing path' };
        const result = await analyzeDirectoryParallel(params.path, {
          maxDepth: params.depth || 5,
          includeContent: params.content !== false
        });
        return { success: true, ...result };
      }

      case "Peek": {
        if (!params.file_path) return { success: false, error: 'Missing file_path' };
        const summary = await streamJsonSummary(params.file_path, params.limit || 100);

        // If aggregation requested, compute it
        if (params.aggregate && summary.records.length > 0) {
          const { groupBy, sumFields = [], countField } = params.aggregate;
          const groups = {};

          for (const record of summary.records) {
            const key = record[groupBy] || '(unknown)';
            if (!groups[key]) {
              groups[key] = { _count: 0 };
              sumFields.forEach(f => groups[key][f] = 0);
            }
            groups[key]._count++;
            sumFields.forEach(f => {
              const val = parseFloat(String(record[f] || 0).replace(/[^0-9.-]/g, ''));
              if (!isNaN(val)) groups[key][f] += val;
            });
          }

          summary.aggregation = Object.entries(groups)
            .map(([key, vals]) => ({ [groupBy]: key, ...vals }))
            .sort((a, b) => (b[sumFields[0]] || b._count) - (a[sumFields[0]] || a._count))
            .slice(0, 20);
        }

        return { success: true, ...summary, fields: Array.from(summary.fields) };
      }

      case "Multi": {
        if (!params.paths || !Array.isArray(params.paths)) return { success: false, error: 'Missing paths array' };
        const maxLines = params.lines || 500;

        const results = await Promise.all(
          params.paths.map(async (filePath) => {
            try {
              const content = await readFile(filePath, 'utf8');
              const lines = content.split('\n');
              const subset = lines.slice(0, maxLines);
              return {
                path: filePath,
                success: true,
                content: subset.join('\n'),
                totalLines: lines.length,
                truncated: lines.length > maxLines
              };
            } catch (err) {
              return { path: filePath, success: false, error: err.message };
            }
          })
        );

        return { success: true, files: results };
      }

      case "Sum": {
        if (!params.path) return { success: false, error: 'Missing path' };
        const groupBy = params.group || 'Product';
        const sumFields = params.fields || ['Gross Sales', 'Items Sold', 'Net Sold'];
        const topN = params.top || 20;
        const reportType = params.type || 'auto';

        // Find all JSON files
        let jsonFiles = [];
        try {
          const pathStat = statSync(params.path);
          if (pathStat.isDirectory()) {
            // Recursively find JSON files
            const findJsonFiles = (dir) => {
              const entries = readdirSync(dir, { withFileTypes: true });
              for (const entry of entries) {
                const fullPath = join(dir, entry.name);
                if (entry.isDirectory()) {
                  findJsonFiles(fullPath);
                } else if (entry.name.endsWith('.json')) {
                  jsonFiles.push(fullPath);
                }
              }
            };
            findJsonFiles(params.path);
          } else {
            jsonFiles = [params.path];
          }
        } catch (err) {
          return { success: false, error: `Path error: ${err.message}` };
        }

        // Filter files to avoid double-counting for COVA exports
        if (reportType === 'auto' && jsonFiles.length > 1) {
          const byLocation = {};
          for (const f of jsonFiles) {
            const dir = dirname(f);
            if (!byLocation[dir]) byLocation[dir] = [];
            byLocation[dir].push(f);
          }

          const selectedFiles = [];
          for (const [loc, files] of Object.entries(byLocation)) {
            const product = files.find(f => /Sales by Product(?! per Day| & Location)/i.test(basename(f)));
            const productLoc = files.find(f => /Sales by Product & Location(?! per Day)/i.test(basename(f)));
            const classification = files.find(f => /Sales by Classification/i.test(basename(f)));
            const productPerDay = files.find(f => /Sales by Product per Day/i.test(basename(f)));

            if (product) selectedFiles.push(product);
            else if (productLoc) selectedFiles.push(productLoc);
            else if (classification) selectedFiles.push(classification);
            else if (productPerDay) selectedFiles.push(productPerDay);
          }

          if (selectedFiles.length > 0) jsonFiles = selectedFiles;
        } else if (reportType !== 'auto') {
          const patterns = {
            product: /Sales by Product(?! per Day| & Location)/i,
            invoice: /Sales by Invoice/i,
            itemized: /Itemized Sales/i,
            daily: /per Day/i,
          };
          if (patterns[reportType]) {
            jsonFiles = jsonFiles.filter(f => patterns[reportType].test(basename(f)));
          }
        }

        // Process files and aggregate
        const aggregated = {};
        let totalRecords = 0;
        let totalSize = 0;

        const processFile = async (filePath) => {
          try {
            const stats = statSync(filePath);
            totalSize += stats.size;

            const content = await readFile(filePath, 'utf8');
            const data = JSON.parse(content);

            if (!Array.isArray(data)) return { success: true, records: 0 };

            for (const record of data) {
              const key = String(record[groupBy] || '(unknown)').slice(0, 50);
              if (!aggregated[key]) {
                aggregated[key] = { _count: 0 };
                sumFields.forEach(f => aggregated[key][f] = 0);
              }
              aggregated[key]._count++;
              totalRecords++;

              sumFields.forEach(f => {
                const val = parseFloat(String(record[f] || 0).replace(/[^0-9.-]/g, ''));
                if (!isNaN(val)) aggregated[key][f] += val;
              });
            }
            return { success: true, records: data.length };
          } catch (err) {
            return { success: false, error: err.message };
          }
        };

        // Process in parallel batches
        for (let i = 0; i < jsonFiles.length; i += PARALLEL_FILE_BATCH) {
          const batch = jsonFiles.slice(i, i + PARALLEL_FILE_BATCH);
          await Promise.all(batch.map(processFile));
        }

        // Sort and return top N
        const mainSumField = sumFields[0] || '_count';
        const results = Object.entries(aggregated)
          .map(([key, vals]) => ({ [groupBy]: key, ...vals }))
          .sort((a, b) => (b[mainSumField] || 0) - (a[mainSumField] || 0))
          .slice(0, topN);

        // Calculate totals
        const allResults = Object.entries(aggregated).map(([key, vals]) => ({ [groupBy]: key, ...vals }));
        const totals = { _count: totalRecords };
        sumFields.forEach(f => {
          totals[f] = allResults.reduce((sum, r) => sum + (r[f] || 0), 0);
        });

        return {
          success: true,
          groupBy,
          sumFields,
          filesProcessed: jsonFiles.length,
          filesUsed: jsonFiles.map(f => basename(f)),
          totalRecords,
          totalSizeFormatted: formatBytes(totalSize),
          results,
          totals,
          chart: {
            type: 'bar',
            title: `Top ${topN} by ${mainSumField}`,
            data: results.slice(0, 10).map(r => ({
              label: r[groupBy],
              value: r[mainSumField] || 0
            }))
          }
        };
      }

      case "TodoWrite": {
        if (!params.todos || !Array.isArray(params.todos)) {
          return { success: false, error: 'Missing todos array' };
        }

        // Store the todo list
        ctx.todos = params.todos;

        // Render the todo list
        process.stdout.write('\n');
        for (const todo of params.todos) {
          let icon, color;
          switch (todo.status) {
            case 'completed':
              icon = '✓'; color = GREEN;
              break;
            case 'in_progress':
              icon = '▸'; color = BLUE;
              break;
            default:
              icon = '○'; color = GRAY;
          }
          process.stdout.write(`  ${color}${icon}${RESET} ${todo.status === 'completed' ? GRAY_DIM : WHITE}${todo.content}${RESET}\n`);
        }
        process.stdout.write('\n');

        const completed = params.todos.filter(t => t.status === 'completed').length;
        const total = params.todos.length;

        return {
          success: true,
          message: `Updated todo list: ${completed}/${total} completed`,
          todos: params.todos
        };
      }

      case "AskUser": {
        if (!params.question) {
          return { success: false, error: 'Missing question' };
        }

        // Display question
        process.stdout.write(`\n  ${BLUE}?${RESET} ${WHITE}${params.question}${RESET}\n`);

        // Show options if provided
        if (params.options && params.options.length > 0) {
          params.options.forEach((opt, i) => {
            process.stdout.write(`    ${GRAY}${i + 1}.${RESET} ${opt}\n`);
          });
          process.stdout.write(`    ${GRAY_DIM}(Enter number or type custom answer)${RESET}\n`);
        }

        // Get user input
        return new Promise((resolve) => {
          const rl = createInterface({ input: process.stdin, output: process.stdout });
          rl.question(`  ${GRAY}>${RESET} `, (answer) => {
            rl.close();

            // Check if answer is a number selecting an option
            const num = parseInt(answer);
            if (params.options && num > 0 && num <= params.options.length) {
              resolve({ success: true, answer: params.options[num - 1] });
            } else {
              resolve({ success: true, answer: answer || '(no answer)' });
            }
          });
        });
      }

      default:
        return { success: false, error: `Unknown tool: ${name}` };
    }
  } catch (err) {
    return { success: false, error: err.message };
  }
}

// =============================================================================
// Spinner (Claude Code style)
// =============================================================================

const SPINNER = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

class Spinner {
  constructor(text) {
    this.text = text;
    this.frame = 0;
    this.interval = null;
    this.start = Date.now();
    this.streaming = false; // Track if we're in streaming mode
  }

  run() {
    this.render();
    this.interval = setInterval(() => this.render(), 80);
    return this;
  }

  render() {
    if (this.streaming) return; // Don't overwrite during streaming
    const s = SPINNER[this.frame % SPINNER.length];
    process.stdout.write(`\r\x1b[K  ${GRAY_DIM}${s}${RESET} ${GRAY}${this.text}${RESET}`);
    this.frame++;
  }

  // Clear current spinner line (for inserting content above)
  clear() {
    process.stdout.write(`\r\x1b[K`);
  }

  // Pause spinner animation (for streaming mode)
  pause() {
    this.streaming = true;
  }

  // Resume spinner animation
  resume() {
    this.streaming = false;
  }

  stop(text, ok = true) {
    if (this.interval) clearInterval(this.interval);
    const elapsed = ((Date.now() - this.start) / 1000).toFixed(1);
    const icon = ok ? `${GREEN}✓${RESET}` : `${RED}✗${RESET}`;
    process.stdout.write(`\r\x1b[K  ${icon} ${GRAY}${text || this.text}${RESET} ${GRAY_DARK}${elapsed}s${RESET}\n`);
  }

  update(text) {
    this.text = text;
  }
}

// =============================================================================
// PROJECT CONTEXT (LISA.md / CLAUDE.md)
// =============================================================================

function loadProjectContext() {
  const cwd = process.cwd();
  const candidates = [
    join(cwd, 'LISA.md'),
    join(cwd, 'CLAUDE.md'),
    join(cwd, '.lisa', 'context.md'),
    join(cwd, '.claude', 'context.md'),
  ];

  for (const file of candidates) {
    try {
      if (existsSync(file)) {
        const content = readFileSync(file, 'utf8');
        // Limit to 10K chars to avoid token bloat
        return content.length > 10000 ? content.substring(0, 10000) + '\n...(truncated)' : content;
      }
    } catch {}
  }
  return null;
}

// Cache project context (reload on cwd change)
let cachedProjectContext = null;
let cachedCwd = null;

function getProjectContext() {
  const cwd = process.cwd();
  if (cwd !== cachedCwd) {
    cachedProjectContext = loadProjectContext();
    cachedCwd = cwd;
    if (cachedProjectContext) {
      console.log(`  ${GRAY_DIM}📄 Loaded project context${RESET}`);
    }
  }
  return cachedProjectContext;
}

// =============================================================================
// API
// =============================================================================

async function sendMessage(message, toolResults = null, pendingContent = null) {
  // Load project context from LISA.md or CLAUDE.md
  const projectContext = getProjectContext();

  // Extract path from message if it starts with a file path
  let workingDir = process.cwd();
  let effectiveMessage = message;

  // Check if message starts with a path like /Users/... /home/... etc
  const pathMatch = message.match(/^(\/(?:Users|home|var|tmp|opt|mnt|Volumes|Applications)[^\s]*)/i);
  if (pathMatch) {
    const extractedPath = pathMatch[1];
    // Check if it's a directory or file
    try {
      const stats = await stat(extractedPath);
      if (stats.isDirectory()) {
        workingDir = extractedPath;
      } else {
        // It's a file, use its parent directory
        workingDir = dirname(extractedPath);
      }
      // Update message to include clear context about the path
      const taskPart = message.slice(extractedPath.length).trim();
      effectiveMessage = `Working in: ${extractedPath}\n\nTask: ${taskPart || 'Explore this directory and help me with it'}`;
    } catch (e) {
      // Path doesn't exist, keep original message
    }
  }

  const body = {
    store_id: ctx.storeId,
    message: effectiveMessage,
    history: ctx.history.map(m => ({ role: m.role, content: m.content })),
    // Local tools for client-side execution
    local_tools: LOCAL_TOOLS,
    // New fields for backend-driven CLI
    working_directory: workingDir,
    platform: process.platform,
    client: 'cli',
    format_hint: 'terminal',
    // Project context from LISA.md or CLAUDE.md
    project_context: projectContext,
    // Style instructions - CRITICAL
    style_instructions: 'CRITICAL: NEVER use emojis or emoticons in ANY response. Use plain ASCII text only. No unicode symbols. Be concise and direct. When given a task with a file path, execute it immediately without asking clarifying questions.',
    // Visualization instructions for chart-compatible responses
    visualization_instructions: `When returning data, format it for visualization:
- For rankings/comparisons: return { chart: { type: 'bar', title: 'Title', data: [{ label: 'Name', value: 123 }] } }
- For trends over time: return { chart: { type: 'line', title: 'Title', data: [{ label: 'Date', value: 123 }] } }
- For proportions: return { chart: { type: 'donut', title: 'Title', data: [{ label: 'Category', value: 45 }] } }
- For KPIs: return { chart: { type: 'metrics', title: 'Title', data: [{ label: 'Revenue', value: '$127K', change: '+12.3%' }] } }
- For tables: return { chart: { type: 'table', title: 'Title', headers: ['Col1', 'Col2'], rows: [['val1', 'val2']] } }
Always include visualizations when showing sales, inventory, revenue, or analytics data.`,
  };
  if (ctx.userId) body.user_id = ctx.userId;
  if (ctx.userEmail) body.user_email = ctx.userEmail;
  if (ctx.storeName) body.store_name = ctx.storeName;
  if (ctx.conversationId) body.conversation_id = ctx.conversationId;
  if (ctx.locationId) body.location_id = ctx.locationId;
  if (ctx.locationName) body.location_name = ctx.locationName;

  // Add tool results if this is a continuation after local tool execution
  if (toolResults) {
    body.tool_results = toolResults;
    body.pending_assistant_content = pendingContent;
  }

  const token = ctx.auth?.accessToken || SERVICE_KEY;
  const res = await fetch(`${SUPABASE_URL}/functions/v1/agentic-loop`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "apikey": ANON_KEY,
      "Authorization": `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) throw new Error(`API error: ${res.status}`);
  return res;
}

async function* parseSSE(response) {
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";
    for (const line of lines) {
      if (line.startsWith("data: ")) {
        try { yield JSON.parse(line.slice(6)); } catch {}
      }
    }
  }
}

// =============================================================================
// Stream Response
// =============================================================================

async function streamResponse(response, userMessage, existingSpinner = null) {
  let fullText = "";
  let lineBuffer = "";  // Buffer for complete lines
  let spinner = existingSpinner || new Spinner("Thinking").run();
  let textStarted = false;

  const formatLine = (line) => {
    return line
      // === SECTION HEADERS === → elegant minimal header
      .replace(/(={3,})\s*([^=]+?)\s*(={3,})/g, (_, _a, title) => {
        const t = title.trim();
        return `\n  ${WHITE}${BOLD}${t}${RESET}\n  ${GRAY_DARK}${'─'.repeat(Math.max(t.length, 20))}${RESET}\n`;
      })
      // ALL CAPS HEADERS (like DAILY REVENUE)
      .replace(/^([A-Z][A-Z\s]{2,})$/gm, (_, title) => {
        return `\n  ${WHITE}${BOLD}${title}${RESET}\n  ${GRAY_DARK}${'─'.repeat(Math.max(title.length, 20))}${RESET}`;
      })
      // Column headers in tables - subtle
      .replace(/^(\s*)(Product|Item|Name|Date|Day|Location|Category|Total|Qty|Revenue|Orders|Amount|Count|Status|Week|Month|Avg|Min|Max)(\s+)/gim, `$1${GRAY_DIM}$2${RESET}$3`)
      // Chart bars - blue accent like Apple
      .replace(/(█+)/g, `${BLUE}$1${RESET}`)
      .replace(/(▓+)/g, `${GRAY}$1${RESET}`)
      .replace(/(░+)/g, `${GRAY_DARK}$1${RESET}`)
      // Money - green, the universal color for money
      .replace(/(\$[\d,]+(?:\.\d+)?)/g, `${GREEN}$1${RESET}`)
      // Percentages - subtle
      .replace(/(\d+\.?\d*%)/g, `${GRAY}$1${RESET}`)
      // Positive changes - green
      .replace(/(\+[\d.]+%|\+\$[\d,]+)/g, `${GREEN}$1${RESET}`)
      // Negative changes - soft red
      .replace(/(-[\d.]+%|-\$[\d,]+)/g, `${RED}$1${RESET}`)
      // Status words - critical (soft red, not shouty)
      .replace(/\b(critical|out of stock|low stock|0 units|overdue|failed|error)\b/gi, `${RED}$1${RESET}`)
      // Status words - warning (soft orange)
      .replace(/\b(warning|low|pending|needs attention|expiring|delayed)\b/gi, `${ORANGE}$1${RESET}`)
      // Status words - success
      .replace(/\b(in stock|complete|success|approved|active|done)\b/gi, `${GREEN}$1${RESET}`)
      // Dates - white to stand out
      .replace(/\b(Mon|Tue|Wed|Thu|Fri|Sat|Sun)\b/gi, `${WHITE}$1${RESET}`)
      .replace(/\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+(\d{1,2})/gi, `${WHITE}$1 $2${RESET}`);
  };

  for await (const event of parseSSE(response)) {
    switch (event.type) {
      case "text":
      case "text_delta":
      case "chunk": {
        // Handle multiple text formats from backend
        let content = event.content || event.text || '';
        if (content) {
          if (!textStarted) {
            // Switch to "Generating" spinner
            if (spinner) {
              spinner.stop("Thinking", true);
              spinner = new Spinner("Generating").run();
            }
            textStarted = true;
            process.stdout.write("\n");
          }

          // Buffer text and output complete lines only
          lineBuffer += content;
          const lines = lineBuffer.split("\n");

          // Keep the last incomplete line in buffer
          lineBuffer = lines.pop() || "";

          // Output complete lines with formatting
          for (const line of lines) {
            if (spinner) spinner.clear();
            process.stdout.write(formatLine(line) + "\n");
          }

          fullText += content;
        }
        break;
      }

      case "content_block_delta": {
        // Claude API format - text delta inside content block
        if (event.delta?.text) {
          if (!textStarted) {
            // Switch to "Generating" spinner
            if (spinner) {
              spinner.stop("Thinking", true);
              spinner = new Spinner("Generating").run();
            }
            textStarted = true;
            process.stdout.write("\n");
          }

          lineBuffer += event.delta.text;
          const lines = lineBuffer.split("\n");
          lineBuffer = lines.pop() || "";

          for (const line of lines) {
            if (spinner) spinner.clear();
            process.stdout.write(formatLine(line) + "\n");
          }

          fullText += event.delta.text;
        }
        break;
      }

      case "thinking":
        // Extended thinking from Claude - show in muted style
        if (event.content) {
          if (spinner) {
            spinner.update("Thinking deeply...");
          }
          // Optionally show thinking content (currently hidden for cleaner UX)
          // process.stdout.write(`\r\x1b[K  ${GRAY_DIM}💭 ${event.content.substring(0, 60)}...${RESET}`);
        }
        break;

      case "usage":
        // Token usage - store for display at end
        if (event.input_tokens || event.output_tokens) {
          ctx.lastUsage = {
            input: event.input_tokens || 0,
            output: event.output_tokens || 0
          };
        }
        break;

      case "tool_start":
        if (textStarted) process.stdout.write("\n");
        if (spinner) {
          spinner.stop(spinner.text, true);
          spinner = null;
        }
        const toolStartName = event.tool_name.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase());
        spinner = new Spinner(toolStartName).run();
        textStarted = false;
        break;

      case "pause_for_tools":
        // Backend is requesting local tool execution - execute and send results back
        if (spinner) {
          spinner.stop(spinner.text, true);
          spinner = null;
        }
        if (textStarted) {
          // Flush line buffer before tools
          if (lineBuffer) {
            process.stdout.write(formatLine(lineBuffer) + "\n");
            lineBuffer = "";
          }
          textStarted = false;
        }

        const pendingTools = event.pending_tools || [];
        if (pendingTools.length > 0) {
          // Execute tools in parallel
          const results = [];
          for (const tool of pendingTools) {
            const toolDisplayName = tool.name.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase());
            spinner = new Spinner(toolDisplayName).run();

            const result = await executeTool(tool.name, tool.input);

            spinner.stop(toolDisplayName, result.success !== false);
            spinner = null;

            results.push({ tool_use_id: tool.id, content: JSON.stringify(result) });
          }

          // Send results back to backend and continue the loop
          const continuation = await sendMessage(userMessage, results, event.assistant_content);
          // Recursively process the continuation response
          return streamResponse(continuation, null, null);
        }
        break;

      case "tool_result":
        if (spinner) {
          const toolResultName = event.tool_name.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase());
          spinner.stop(toolResultName, true);
          spinner = null;
        }
        // Try to render chart from tool result data
        if (event.result) {
          try {
            const resultData = typeof event.result === 'string' ? JSON.parse(event.result) : event.result;
            const chartOutput = tryRenderChart(resultData, event.tool_name);
            if (chartOutput) {
              process.stdout.write('\n' + chartOutput + '\n');
            }
          } catch {}
        }
        break;

      case "error":
        if (spinner) {
          spinner.stop("Error", false);
          spinner = null;
        }
        console.error(`\n${RED}Error: ${event.error}${RESET}`);
        return;

      case "done":
        if (spinner) {
          spinner.stop(spinner.text, true);
          spinner = null;
        }
        // Flush remaining buffer
        if (lineBuffer) {
          process.stdout.write(formatLine(lineBuffer));
          lineBuffer = "";
        }
        if (!textStarted) process.stdout.write("\n");

        // Show token usage if available (subtle footer)
        if (ctx.lastUsage && (ctx.lastUsage.input > 0 || ctx.lastUsage.output > 0)) {
          const totalTokens = ctx.lastUsage.input + ctx.lastUsage.output;
          // Estimate cost: ~$3/M input, ~$15/M output for Claude 3.5 Sonnet
          const costEstimate = (ctx.lastUsage.input * 0.003 / 1000) + (ctx.lastUsage.output * 0.015 / 1000);
          process.stdout.write(`\n${GRAY_DIM}  ⎯ ${totalTokens.toLocaleString()} tokens (~$${costEstimate.toFixed(4)})${RESET}\n`);
        }
        break;
    }
  }

  // Final flush just in case
  if (lineBuffer) {
    process.stdout.write(formatLine(lineBuffer) + "\n");
  }

  // Update history
  if (userMessage) {
    ctx.history.push({ role: "user", content: userMessage });
    if (ctx.auth && ctx.conversationId) {
      saveMessage(ctx.auth.accessToken, ctx.conversationId, "user", userMessage).catch(() => {});
    }
  }
  if (fullText) {
    ctx.history.push({ role: "assistant", content: fullText });
    if (ctx.auth && ctx.conversationId) {
      saveMessage(ctx.auth.accessToken, ctx.conversationId, "assistant", fullText).catch(() => {});
    }
  }

  // Trim history
  if (ctx.history.length > 20) ctx.history = ctx.history.slice(-20);

  // Save session
  saveSession({
    conversationId: ctx.conversationId,
    storeId: ctx.storeId,
    locationId: ctx.locationId,
    historyLength: ctx.history.length,
    localHistory: !ctx.auth ? ctx.history : undefined,
  });

  process.stdout.write("\n");
}

// =============================================================================
// Init Session
// =============================================================================

async function initSession(opts = {}) {
  const auth = await getValidAuth();

  if (auth) {
    ctx.auth = auth;
    ctx.storeId = auth.storeId;
    ctx.storeName = auth.storeName;
    ctx.userId = auth.user?.id;
    ctx.userEmail = auth.user?.email;

    // If userId is not a valid UUID, look it up by email
    const isValidUUID = ctx.userId && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(ctx.userId);
    if (!isValidUUID && ctx.userEmail) {
      try {
        const userRes = await fetch(
          `${SUPABASE_URL}/rest/v1/users?email=eq.${encodeURIComponent(ctx.userEmail)}&select=auth_user_id`,
          { headers: { "apikey": SERVICE_KEY, "Authorization": `Bearer ${SERVICE_KEY}` } }
        );
        if (userRes.ok) {
          const users = await userRes.json();
          if (users.length > 0 && users[0].auth_user_id) {
            ctx.userId = users[0].auth_user_id;
          }
        }
      } catch {}
    }

    if (opts.location) {
      const loc = auth.locations?.find(l =>
        l.id === opts.location || l.name.toLowerCase().includes(opts.location.toLowerCase())
      );
      if (loc) {
        ctx.locationId = loc.id;
        ctx.locationName = loc.name;
      }
    }

    // Always start fresh - no auto-resume
    // User can resume previous chats via /history command

    ctx.conversationId = await getOrCreateConversation(auth.accessToken, auth.storeId, ctx.locationId);
    // Always load history from database (might have messages from previous sessions)
    ctx.history = await loadHistory(auth.accessToken, ctx.conversationId);

    // Load backend-driven menu config
    ctx.menuConfig = await loadMenuConfig(auth.storeId);

    return false;
  } else {
    // No demo mode - require login
    return null;
  }
}

// =============================================================================
// Interactive Mode
// =============================================================================

async function interactive(hasPrevious) {
  console.clear();

  // Get current time for dynamic greeting
  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
  const userName = ctx.userEmail?.split('@')[0] || 'there';

  // Gradient bar
  const gradientBar = () => {
    const colors = [51, 50, 49, 45, 44, 39, 38, 33, 32, 27];
    return colors.map(c => `\x1b[38;5;${c}m━━━━━━`).join('') + RESET;
  };

  // Store info
  const storeDisplay = ctx.storeName || 'Flora';
  const locationDisplay = ctx.locationName || 'All locations';

  // Rotating taglines
  const taglines = [
    "Your data speaks. I translate.",
    "Insights at the speed of thought",
    "Know your numbers. Own your future.",
    "From chaos to clarity",
    "Ask anything. Get answers.",
  ];
  const tagline = taglines[Math.floor(Math.random() * taglines.length)];

  // Clean header with gradient accent
  console.log();
  console.log(`  ${gradientBar()}`);
  console.log();
  console.log(`  ${WHITE}${BOLD}${storeDisplay}${RESET}  ${GRAY_DARK}›${RESET}  ${GRAY}${locationDisplay}${RESET}`);
  console.log();
  console.log(`  ${WHITE}${greeting}, ${BOLD}${userName}${RESET}${WHITE}.${RESET}`);
  console.log(`  ${GRAY_DIM}${tagline}${RESET}`);
  console.log();

  // Session info
  if (hasPrevious && ctx.history.length > 0) {
    console.log(`  ${GRAY_DIM}↩ ${ctx.history.length} messages${RESET}  ${GRAY_DARK}·${RESET}  ${BLUE}/new${RESET} ${GRAY_DIM}fresh start${RESET}`);
  } else {
    console.log(`  ${GRAY_DIM}Try${RESET}  ${WHITE}"sales today"${RESET}  ${GRAY_DARK}·${RESET}  ${WHITE}"low stock"${RESET}  ${GRAY_DARK}·${RESET}  ${WHITE}"top products"${RESET}`);
  }

  console.log();

  // ==========================================================================
  // SLASH COMMAND MENU SYSTEM
  // ==========================================================================

  // All available commands - combines backend menu config with local commands
  const getCommands = () => {
    // Start with backend-driven menu items if available
    const commands = [];

    // Add backend menu items first (from cli_menu_config)
    if (ctx.menuConfig?.length) {
      for (const item of ctx.menuConfig) {
        commands.push({
          cmd: `/${item.item_id}`,
          desc: item.description || item.label,
          icon: item.icon || "●",
          category: item.menu_type || "main",
          action: item.action,
          value: item.value,
        });
      }
    } else {
      // Fallback to hardcoded menu if backend config not loaded
      commands.push(
        { cmd: "/new_chat", desc: "Start fresh", icon: "+", category: "main", action: "view", value: "new_chat" },
        { cmd: "/history", desc: "Chat history", icon: "↵", category: "main", action: "view", value: "history" },
        { cmd: "/team", desc: "Team chats", icon: "◆", category: "main", action: "view", value: "team" },
        { cmd: "/alerts", desc: "Alerts", icon: "!", category: "main", action: "view", value: "alerts" },
        { cmd: "/locations", desc: "Switch location", icon: "◇", category: "main", action: "view", value: "locations" },
      );
    }

    // Always add local-only commands (not backend-driven)
    commands.push(
      { cmd: "/lisa", desc: "Private AI chat", icon: "●", category: "chat" },
      { cmd: "/new", desc: "Start fresh conversation", icon: "✦", category: "chat" },
      { cmd: "/clear", desc: "Clear screen", icon: "○", category: "view" },
      { cmd: "/login", desc: "Sign in to your account", icon: "→", category: "auth" },
      { cmd: "/logout", desc: "Sign out", icon: "←", category: "auth" },
      { cmd: "/status", desc: "View connection status", icon: "●", category: "info" },
      { cmd: "/settings", desc: "Configure Lisa", icon: "⚙", category: "system" },
      { cmd: "/update", desc: "Check for updates", icon: "↑", category: "system" },
      { cmd: "/help", desc: "Show all commands", icon: "?", category: "info" },
      { cmd: "/quit", desc: "Exit Lisa", icon: "⏻", category: "system" },
    );

    // Add location shortcuts if authenticated
    if (ctx.auth?.locations?.length) {
      for (const loc of ctx.auth.locations.slice(0, 5)) {
        commands.push({
          cmd: `/loc:${loc.name.toLowerCase().replace(/\s+/g, '-')}`,
          desc: `Switch to ${loc.name}`,
          icon: ctx.locationId === loc.id ? "●" : "○",
          category: "location",
          location: loc
        });
      }
    }

    return commands;
  };

  // Execute command
  const executeCommand = async (item) => {

    // Location switch
    if (item.location) {
      ctx.locationId = item.location.id;
      ctx.locationName = item.location.name;
      if (ctx.auth) {
        ctx.conversationId = await getOrCreateConversation(ctx.auth.accessToken, ctx.storeId, ctx.locationId);
      }
      ctx.history = [];
      saveSession({
        conversationId: ctx.conversationId,
        locationId: ctx.locationId,
        locationName: ctx.locationName,
        storeId: ctx.storeId,
        historyLength: 0
      });
      console.log();
      console.log(`  ${GREEN}✓${RESET} ${WHITE}Switched to ${item.location.name}${RESET}`);
      console.log();
      return true;
    }

    switch (item.cmd) {
      case "/location":
      case "/locations":
        if (!ctx.auth?.locations?.length) {
          console.log(`\n  ${GRAY_DIM}No locations available. Login first.${RESET}\n`);
        } else {
          console.log(`\n  ${WHITE}${BOLD}Locations${RESET}\n`);
          for (const loc of ctx.auth.locations) {
            const active = ctx.locationId === loc.id;
            const icon = active ? `${GREEN}●${RESET}` : `${GRAY_DIM}○${RESET}`;
            const name = active ? `${WHITE}${loc.name}${RESET}` : `${GRAY}${loc.name}${RESET}`;
            console.log(`  ${icon} ${name}`);
          }
          console.log(`\n  ${GRAY_DIM}Type /loc:name to switch${RESET}\n`);
        }
        return true;

      case "/new":
      case "/new_chat":
        if (ctx.auth) {
          ctx.conversationId = await getOrCreateConversation(ctx.auth.accessToken, ctx.storeId, ctx.locationId);
        }
        ctx.history = [];
        // Preserve location when starting new conversation
        saveSession({
          conversationId: ctx.conversationId,
          locationId: ctx.locationId,
          locationName: ctx.locationName,
          storeId: ctx.storeId,
          historyLength: 0
        });
        console.log(`\n  ${GREEN}✓${RESET} ${GRAY}New conversation started${RESET}\n`);
        return true;

      case "/history":
        // History is handled interactively in the live menu system
        return "history";

      case "/clear":
        console.clear();
        // Redraw header
        console.log();
        console.log(`  ${WHITE}${BOLD}${ctx.storeName || 'Flora'}${RESET}  ${GRAY_DARK}›${RESET}  ${GRAY}${ctx.locationName || 'All locations'}${RESET}`);
        console.log();
        return true;

      case "/status":
        console.log(`\n  ${WHITE}${BOLD}Status${RESET}\n`);
        console.log(`  ${GRAY_DIM}Store${RESET}     ${WHITE}${ctx.storeName || 'Flora'}${RESET}`);
        console.log(`  ${GRAY_DIM}Location${RESET}  ${WHITE}${ctx.locationName || 'All locations'}${RESET}`);
        console.log(`  ${GRAY_DIM}Auth${RESET}      ${ctx.auth ? `${GREEN}●${RESET} ${GRAY}${ctx.userEmail}${RESET}` : `${ORANGE}○${RESET} ${GRAY}demo mode${RESET}`}`);
        console.log(`  ${GRAY_DIM}Messages${RESET}  ${WHITE}${ctx.history.length}${RESET}`);
        console.log();
        return true;

      case "/login":
        console.log(`\n  ${GRAY_DIM}Run${RESET} ${WHITE}lisa login${RESET} ${GRAY_DIM}from terminal${RESET}\n`);
        return true;

      case "/logout":
        clearAuth();
        clearSession();
        ctx.auth = null;
        console.log(`\n  ${GREEN}✓${RESET} ${GRAY}Logged out${RESET}\n`);
        return true;

      case "/help":
        console.log(`\n  ${WHITE}${BOLD}Commands${RESET}\n`);
        const categories = {};
        for (const c of getCommands()) {
          if (!categories[c.category]) categories[c.category] = [];
          categories[c.category].push(c);
        }
        for (const [cat, cmds] of Object.entries(categories)) {
          if (cat === 'location') continue;
          for (const c of cmds) {
            console.log(`  ${GRAY_DIM}${c.icon}${RESET} ${BLUE}${c.cmd}${RESET}  ${GRAY_DIM}${c.desc}${RESET}`);
          }
        }
        console.log();
        return true;

      case "/settings":
        const config = loadConfig();
        console.log(`\n  ${WHITE}${BOLD}Settings${RESET}\n`);
        console.log(`  ${GRAY_DIM}Version${RESET}        ${WHITE}${VERSION}${RESET}`);
        console.log(`  ${GRAY_DIM}Auto-update${RESET}    ${config.autoUpdate ? `${GREEN}on${RESET}` : `${GRAY}off${RESET}`}`);
        console.log(`  ${GRAY_DIM}Channel${RESET}        ${WHITE}${config.updateChannel}${RESET}`);
        console.log(`  ${GRAY_DIM}Theme${RESET}          ${WHITE}${config.ui?.theme || 'dark'}${RESET}`);
        console.log(`  ${GRAY_DIM}Colors${RESET}         ${config.ui?.colors ? `${GREEN}on${RESET}` : `${GRAY}off${RESET}`}`);
        console.log(`  ${GRAY_DIM}Animations${RESET}     ${config.ui?.animations ? `${GREEN}on${RESET}` : `${GRAY}off${RESET}`}`);
        console.log(`  ${GRAY_DIM}History limit${RESET}  ${WHITE}${config.session?.historyLimit || 20}${RESET}`);
        console.log(`  ${GRAY_DIM}Session timeout${RESET} ${WHITE}${Math.round((config.session?.timeout || 1800000) / 60000)}m${RESET}`);
        console.log(`  ${GRAY_DIM}Debug${RESET}          ${config.debug ? `${GREEN}on${RESET}` : `${GRAY}off${RESET}`}`);
        console.log();
        console.log(`  ${GRAY_DIM}Config file: ${CONFIG_FILE}${RESET}`);
        console.log();
        return true;

      case "/update":
        await performUpdate();
        return true;

      case "/quit":
      case "/exit":
      case "/q":
        console.log(`\n${DIM}Goodbye${RESET}\n`);
        process.exit(0);

      default:
        return false;
    }
  };

  // ==========================================================================
  // LIVE INPUT WITH MENU
  // ==========================================================================

  let inputBuffer = "";
  let menuItems = [];
  let menuIndex = 0;
  let menuVisible = false;
  let isProcessing = false;
  let lastMenuLines = 0; // How many menu lines were rendered last time
  let prevInputRows = 1; // Legacy - keeping for compatibility

  // Get terminal dimensions
  const getWidth = () => process.stdout.columns || 80;
  const getHeight = () => process.stdout.rows || 24;

  // Calculate how many visual rows the input takes (handles wrapping)
  const getInputRows = () => {
    const width = getWidth();
    const totalLen = getPrompt().length + inputBuffer.length;
    return Math.max(1, Math.ceil(totalLen / width) || 1);
  };

  // Get the prompt prefix based on current context
  const getPrompt = () => {
    if (ctx.chatType === 'team') {
      return `${ctx.chatName} > `;
    }
    return `> `;
  };

  // Draw edge-to-edge divider line (Claude Code style)
  const drawDivider = () => {
    const width = getWidth();
    return `${GRAY_DARK}${'─'.repeat(width)}${RESET}`;
  };

  // Track if we've drawn the input box
  let inputBoxDrawn = false;

  // Show prompt with divider above
  const showPrompt = () => {
    process.stdout.write(drawDivider() + '\n');  // Divider above
    process.stdout.write(getPrompt());            // Prompt (cursor at end)
    lastMenuLines = 0; // Reset menu state for new prompt
  };

  // Check if input looks like a file path (not a command)
  const looksLikePath = (str) => {
    if (!str || !str.startsWith('/')) return false;
    // Common path prefixes (match full or partial, e.g. /U matches /Users)
    const pathPrefixes = ['Users', 'home', 'var', 'tmp', 'etc', 'opt', 'usr', 'bin', 'lib', 'mnt', 'dev', 'proc', 'sys', 'root', 'Applications', 'Library', 'Volumes', 'private'];
    const afterSlash = str.slice(1).split('/')[0].toLowerCase();
    if (pathPrefixes.some(p => p.toLowerCase().startsWith(afterSlash) && afterSlash.length > 0)) return true;
    // Has a second slash within first 15 chars (like /foo/bar)
    if (str.indexOf('/', 1) > 0 && str.indexOf('/', 1) < 15) return true;
    // Contains file extension patterns
    if (/\.\w{1,5}$/.test(str)) return true;
    return false;
  };

  // Full render using Node's proper terminal APIs
  const render = () => {
    if (isProcessing) return;

    // Step 1: Clear previous menu lines (if any) by moving up and clearing
    if (lastMenuLines > 0) {
      process.stdout.moveCursor(0, -lastMenuLines);
      process.stdout.clearScreenDown();
      process.stdout.moveCursor(0, -1); // Go back up to input line
    }

    // Step 2: Clear current line and redraw input
    process.stdout.cursorTo(0);
    process.stdout.clearLine(0);
    process.stdout.write(getPrompt() + inputBuffer);

    // Step 3: Draw menu below if visible
    let menuLines = 0;
    if (menuVisible && menuItems.length > 0) {
      process.stdout.write('\n');
      menuItems.forEach((item, i) => {
        const selected = i === menuIndex;
        const prefix = selected ? `${BLUE}▸${RESET} ` : '  ';
        const cmdStyle = selected ? `${WHITE}${BOLD}` : `${GRAY}`;
        const descStyle = selected ? `${GRAY}` : `${GRAY_DIM}`;
        process.stdout.write(`${prefix}${cmdStyle}${item.cmd}${RESET}  ${descStyle}${item.desc}${RESET}\n`);
        menuLines++;
      });
      // Move cursor back up to input line
      process.stdout.moveCursor(0, -menuLines - 1);
      // Position at end of input
      process.stdout.cursorTo(getPrompt().length + inputBuffer.length);
    } else if (submenu.visible && submenu.items.length > 0) {
      process.stdout.write('\n');
      process.stdout.write(`  ${WHITE}${BOLD}${submenu.title}${RESET}\n`);
      menuLines = 2;
      submenu.items.forEach((item, i) => {
        const selected = i === submenu.index;
        const prefix = selected ? `${BLUE}▸${RESET} ` : '  ';
        const labelStyle = selected ? `${WHITE}` : `${GRAY}`;
        const hintStyle = `${GRAY_DIM}`;
        const hint = item.hint ? `  ${hintStyle}${item.hint}${RESET}` : '';
        process.stdout.write(`${prefix}${labelStyle}${item.label}${RESET}${hint}\n`);
        menuLines++;
      });
      if (submenu.hint) {
        process.stdout.write(`  ${GRAY_DIM}${submenu.hint}${RESET}\n`);
        menuLines++;
      }
      // Move cursor back up to input line
      process.stdout.moveCursor(0, -menuLines);
      process.stdout.cursorTo(getPrompt().length + inputBuffer.length);
    }

    // Remember menu lines for next clear
    lastMenuLines = menuLines;
  };

  // Update menu based on input
  const updateMenu = () => {
    const commands = getCommands();

    // Don't show menu for file paths
    if (looksLikePath(inputBuffer)) {
      menuItems = [];
      menuVisible = false;
      return;
    }

    if (inputBuffer === "/") {
      menuItems = commands.slice(0, 9);
      menuIndex = 0;
      menuVisible = true;
    } else if (inputBuffer.startsWith("/") && inputBuffer.length > 1) {
      const q = inputBuffer.slice(1).toLowerCase();
      menuItems = commands.filter(c =>
        c.cmd.toLowerCase().includes(q) ||
        c.desc.toLowerCase().includes(q)
      ).slice(0, 6);
      menuIndex = 0;
      menuVisible = menuItems.length > 0;
    } else {
      menuItems = [];
      menuVisible = false;
    }
  };

  // Close menu
  const closeMenu = () => {
    menuVisible = false;
    menuItems = [];
    menuIndex = 0;
  };

  // ==========================================================================
  // GENERIC SUBMENU SYSTEM
  // ==========================================================================

  let submenu = {
    visible: false,
    type: null,        // 'history', 'location', 'team'
    title: '',
    items: [],
    index: 0,
    hint: '',
    onSelect: null,    // callback when item selected
  };

  const closeSubmenu = () => {
    submenu = { visible: false, type: null, title: '', items: [], index: 0, hint: '', onSelect: null };
  };

  // Open history submenu - loads all user's conversations from database
  const openHistoryMenu = async () => {
    if (!ctx.storeId) {
      return false;
    }

    try {
      // Load all AI conversations for this user/store
      const url = `${SUPABASE_URL}/rest/v1/lisa_conversations?store_id=eq.${ctx.storeId}&chat_type=eq.ai&select=id,title,location_id,updated_at,locations(name)&order=updated_at.desc&limit=10`;
      const res = await fetch(url, { headers: { "apikey": SERVICE_KEY, "Authorization": `Bearer ${SERVICE_KEY}` } });

      if (!res.ok) {
        return false;
      }
      const conversations = await res.json();
      if (conversations.length === 0) {
        return false;
      }

      submenu = {
        visible: true,
        type: 'history',
        title: 'History',
        items: conversations.map(c => ({
          label: c.locations?.name || 'All locations',
          desc: new Date(c.updated_at).toLocaleDateString(),
          data: { conversationId: c.id, locationId: c.location_id, locationName: c.locations?.name },
        })),
        index: 0,
        hint: '↑↓ navigate · enter select · esc cancel',
        onSelect: async (item) => {
          ctx.chatType = 'ai';
          ctx.chatName = 'Lisa';
          ctx.locationId = item.data.locationId;
          ctx.locationName = item.data.locationName;
          ctx.conversationId = item.data.conversationId;
          ctx.history = await loadHistory(ctx.auth?.accessToken, ctx.conversationId);

          console.clear();
          console.log();
          if (ctx.locationName) {
            console.log(`${WHITE}${BOLD}${ctx.storeName}${RESET}  ${GRAY_DARK}›${RESET}  ${GRAY}${ctx.locationName}${RESET}`);
          } else {
            console.log(`${WHITE}${BOLD}${ctx.storeName}${RESET}`);
          }
          console.log();
          console.log(`${GRAY_DIM}${ctx.history.length} messages${RESET}`);
          console.log();
        },
      };
      return true;
    } catch (e) {
      return false;
    }
  };

  // Open location submenu
  const openLocationMenu = () => {
    if (!ctx.auth?.locations?.length) return false;

    submenu = {
      visible: true,
      type: 'location',
      title: 'Locations',
      items: ctx.auth.locations.map(loc => ({
        label: loc.name,
        data: loc,
      })),
      index: Math.max(0, ctx.auth.locations.findIndex(l => l.id === ctx.locationId)),
      hint: '↑↓ navigate · enter select · esc cancel',
      onSelect: async (item) => {
        ctx.chatType = 'ai';
        ctx.chatName = 'Lisa';
        ctx.locationId = item.data.id;
        ctx.locationName = item.data.name;
        ctx.conversationId = await getOrCreateConversation(ctx.auth?.accessToken, ctx.storeId, ctx.locationId);
        ctx.history = await loadHistory(ctx.auth?.accessToken, ctx.conversationId);

        saveSession({
          conversationId: ctx.conversationId,
          locationId: ctx.locationId,
          locationName: ctx.locationName,
          storeId: ctx.storeId,
          historyLength: ctx.history.length
        });

        console.clear();
        console.log();
        console.log(`${WHITE}${BOLD}${ctx.storeName}${RESET}  ${GRAY_DARK}›${RESET}  ${GRAY}${ctx.locationName}${RESET}`);
        console.log();
        if (ctx.history.length > 0) {
          console.log(`${GRAY_DIM}${ctx.history.length} messages${RESET}`);
        }
        console.log();
      },
    };
    return true;
  };

  // Switch to private AI chat (clears location - store-wide context)
  const switchToPrivateChat = async () => {
    ctx.chatType = 'ai';
    ctx.chatName = 'Lisa';
    ctx.locationId = null;
    ctx.locationName = null;
    ctx.conversationId = await getOrCreateConversation(ctx.auth?.accessToken, ctx.storeId, null);
    ctx.history = await loadHistory(ctx.auth?.accessToken, ctx.conversationId);

    console.clear();
    console.log();
    console.log(`${WHITE}${BOLD}${ctx.storeName || 'Lisa'}${RESET}`);
    console.log();

    if (ctx.history.length > 0) {
      console.log(`${GRAY_DIM}${ctx.history.length} messages${RESET}`);
    }
    console.log();
    showPrompt();
  };

  // Open team chat submenu - shows location team chats
  const openTeamMenu = async () => {
    if (!ctx.storeId) return false;

    // Load all location team chats from database
    const locationChats = await loadLocationTeamChats(ctx.storeId);
    if (locationChats.length === 0) return false;

    submenu = {
      visible: true,
      type: 'team',
      title: 'Team Chats',
      items: locationChats.map(chat => ({
        label: chat.name,
        icon: ctx.locationId === chat.locationId ? `${GREEN}●${RESET}` : `${GRAY_DIM}○${RESET}`,
        data: chat,
      })),
      index: Math.max(0, locationChats.findIndex(c => c.locationId === ctx.locationId)),
      hint: '↑↓ navigate · enter select · esc cancel',
      onSelect: async (item) => {
        // Switch to team chat mode
        ctx.chatType = 'team';
        ctx.chatName = item.data.name;
        ctx.locationId = item.data.locationId;
        ctx.locationName = item.data.locationName;

        // Set team chat location context for AI
        ctx.teamChatLocation = {
          locationId: item.data.locationId,
          locationName: item.data.locationName
        };

        // Get or create the location team chat conversation
        const chatId = await getOrCreateLocationChat(ctx.auth?.accessToken, ctx.storeId, item.data.locationId);
        ctx.conversationId = chatId;

        // Load team chat history
        const teamHistory = await loadTeamChatHistory(chatId);

        // Clear screen and show team chat
        console.clear();
        console.log();
        console.log(`${WHITE}${BOLD}${item.data.name}${RESET}`);
        console.log();

        if (teamHistory.length === 0) {
          console.log(`${GRAY_DIM}No messages yet${RESET}`);
          console.log();
        } else {
          // Display team chat messages with clear visual separation
          for (const msg of teamHistory) {
            const time = new Date(msg.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
            if (msg.role === 'user') {
              const sender = msg.sender_name || 'Unknown';
              console.log(`${BLUE}${sender}${RESET}  ${GRAY_DIM}${time}${RESET}`);
              console.log(`${msg.content}`);
              console.log();
            } else {
              console.log(`${GREEN}Lisa${RESET}  ${GRAY_DIM}${time}${RESET}`);
              const lines = msg.content.split('\n');
              for (const line of lines) {
                console.log(line);
              }
              console.log();
            }
          }
        }

        console.log(`${GRAY_DIM}@lisa to ask · /team to switch · /lisa for private chat${RESET}`);
        console.log();
      },
    };
    return true;
  };

  // Load all location team chats for the store
  async function loadLocationTeamChats(storeId) {
    // Get all location chats with their location info
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/lisa_conversations?store_id=eq.${storeId}&chat_type=eq.location&select=id,title,location_id,message_count,locations(id,name)&order=title.asc`,
      { headers: { "apikey": SERVICE_KEY, "Authorization": `Bearer ${SERVICE_KEY}` } }
    );

    if (!res.ok) return [];

    const chats = await res.json();
    return chats.map(c => ({
      id: c.id,
      name: c.locations?.name ? `${c.locations.name} Team` : c.title,
      locationId: c.location_id,
      locationName: c.locations?.name || 'Unknown',
      messageCount: c.message_count || 0,
    })).sort((a, b) => a.locationName.localeCompare(b.locationName));
  }

  // Get or create location team chat
  async function getOrCreateLocationChat(accessToken, storeId, locationId) {
    // First try to find existing location chat
    const findRes = await fetch(
      `${SUPABASE_URL}/rest/v1/lisa_conversations?store_id=eq.${storeId}&location_id=eq.${locationId}&chat_type=eq.location&select=id&limit=1`,
      { headers: { "apikey": SERVICE_KEY, "Authorization": `Bearer ${SERVICE_KEY}` } }
    );

    if (findRes.ok) {
      const existing = await findRes.json();
      if (existing.length > 0) {
        return existing[0].id;
      }
    }

    // Create new location chat
    const location = ctx.auth.locations.find(l => l.id === locationId);
    const createRes = await fetch(
      `${SUPABASE_URL}/rest/v1/lisa_conversations`,
      {
        method: "POST",
        headers: {
          "apikey": SERVICE_KEY,
          "Authorization": `Bearer ${SERVICE_KEY}`,
          "Content-Type": "application/json",
          "Prefer": "return=representation"
        },
        body: JSON.stringify({
          store_id: storeId,
          location_id: locationId,
          chat_type: "location",
          title: `${location?.name || 'Location'} Team`,
          status: "active"
        })
      }
    );

    if (createRes.ok) {
      const created = await createRes.json();
      return created[0].id;
    }

    throw new Error("Failed to create location chat");
  }

  // Load team chat history
  async function loadTeamChatHistory(conversationId, limit = 20) {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/lisa_messages?conversation_id=eq.${conversationId}&select=id,role,content,created_at,sender_id&order=created_at.desc&limit=${limit}`,
      { headers: { "apikey": SERVICE_KEY, "Authorization": `Bearer ${SERVICE_KEY}` } }
    );

    if (!res.ok) return [];

    const msgs = await res.json();

    // Get sender emails from users table (uses auth_user_id)
    const senderIds = [...new Set(msgs.filter(m => m.sender_id).map(m => m.sender_id))];
    const emailMap = {};

    if (senderIds.length > 0) {
      // Batch fetch user emails
      const idsFilter = senderIds.map(id => `auth_user_id.eq.${id}`).join(',');
      const userRes = await fetch(
        `${SUPABASE_URL}/rest/v1/users?or=(${idsFilter})&select=auth_user_id,email,first_name`,
        { headers: { "apikey": SERVICE_KEY, "Authorization": `Bearer ${SERVICE_KEY}` } }
      );
      if (userRes.ok) {
        const users = await userRes.json();
        for (const u of users) {
          emailMap[u.auth_user_id] = u.first_name || u.email?.split('@')[0] || 'Unknown';
        }
      }
    }

    return msgs.reverse().map(m => ({
      ...m,
      sender_name: emailMap[m.sender_id] || null
    }));
  }

  // Execute selected command or send message
  const submit = async () => {
    const input = inputBuffer.trim();
    const hadMenu = menuVisible;
    const hadSubmenu = submenu.visible;
    const submenuType = submenu.type;
    const selectedItem = hadMenu && menuItems.length > 0 ? menuItems[menuIndex] : null;
    const selectedSubmenuItem = hadSubmenu && submenu.items.length > 0 ? submenu.items[submenu.index] : null;
    const submenuCallback = submenu.onSelect;

    // Clear just the input line (menu will be overwritten or scrolled away)
    process.stdout.cursorTo(0);
    process.stdout.clearLine(0);

    // Clear state
    inputBuffer = "";
    lastMenuLines = 0;
    prevInputRows = 1;
    closeMenu();
    closeSubmenu();

    // Handle submenu selection (all submenus now use onSelect callback)
    if (selectedSubmenuItem && submenuCallback) {
      await submenuCallback(selectedSubmenuItem);
      showPrompt();
      return;
    }

    if (!input && !selectedItem) {
      showPrompt();
      return;
    }

    // If we had a command menu selection, execute that command
    if (selectedItem) {
      // Commands that open submenus (don't echo - menu replaces input)
      if (selectedItem.cmd === "/history") {
        if (await openHistoryMenu()) {
          render();
        } else {
          process.stdout.write(`${getPrompt()}${selectedItem.cmd}\n`);
          console.log(`  ${GRAY_DIM}No messages in history${RESET}\n`);
          showPrompt();
        }
        return;
      }

      if (selectedItem.cmd === "/location" || selectedItem.cmd === "/locations") {
        if (openLocationMenu()) {
          render();
        } else {
          process.stdout.write(`${getPrompt()}${selectedItem.cmd}\n`);
          console.log(`  ${GRAY_DIM}No locations available. Login first.${RESET}\n`);
          showPrompt();
        }
        return;
      }

      if (selectedItem.cmd === "/team") {
        if (await openTeamMenu()) {
          render();
        } else {
          process.stdout.write(`${getPrompt()}${selectedItem.cmd}\n`);
          console.log(`  ${GRAY_DIM}Team chat not available${RESET}\n`);
          showPrompt();
        }
        return;
      }

      if (selectedItem.cmd === "/lisa") {
        await switchToPrivateChat();
        return;
      }

      // Echo command for other commands with divider below
      process.stdout.write(`${getPrompt()}${selectedItem.cmd}\n`);
      process.stdout.write(drawDivider() + '\n');
      isProcessing = true;
      await executeCommand(selectedItem);
      isProcessing = false;
      process.stdout.write('\n');
      showPrompt();
      return;
    }

    // Handle commands that open submenus (don't echo - menu replaces input)
    if (input === "/history") {
      if (await openHistoryMenu()) {
        render();
      } else {
        process.stdout.write(`${getPrompt()}${input}\n`);
        console.log(`  ${GRAY_DIM}No messages in history${RESET}\n`);
        showPrompt();
      }
      return;
    }

    if (input === "/location" || input === "/locations") {
      if (openLocationMenu()) {
        render();
      } else {
        process.stdout.write(`${getPrompt()}${input}\n`);
        console.log(`  ${GRAY_DIM}No locations available. Login first.${RESET}\n`);
        showPrompt();
      }
      return;
    }

    if (input === "/team") {
      if (await openTeamMenu()) {
        render();
      } else {
        process.stdout.write(`${getPrompt()}${input}\n`);
        console.log(`  ${GRAY_DIM}Team chat not available${RESET}\n`);
        showPrompt();
      }
      return;
    }

    if (input === "/lisa") {
      // Already in private chat, just refresh
      await switchToPrivateChat();
      return;
    }

    // Echo the command for other inputs with divider below (Claude Code style)
    process.stdout.write(`${getPrompt()}${input}\n`);
    process.stdout.write(drawDivider() + '\n');

    // Quick exit commands
    if (input === "/quit" || input === "/exit" || input === "/q") {
      console.log(`\n${DIM}Goodbye${RESET}\n`);
      process.exit(0);
    }

    if (input === "/logout") {
      clearAuth();
      clearSession();
      ctx.auth = null;
      console.log(`\n  ${GREEN}✓${RESET} ${GRAY}Logged out${RESET}\n`);
      showPrompt();
      return;
    }

    // Check for location shortcut
    if (input.startsWith("/loc:")) {
      const locName = input.slice(5).toLowerCase().replace(/-/g, ' ');
      const loc = ctx.auth?.locations?.find(l =>
        l.name.toLowerCase().includes(locName)
      );
      if (loc) {
        isProcessing = true;
        await executeCommand({ cmd: input, location: loc });
        isProcessing = false;
        process.stdout.write('\n');
        showPrompt();
        return;
      }
      console.log(`  ${RED}✗${RESET} ${GRAY}Location not found${RESET}\n`);
      showPrompt();
      return;
    }

    // Check for exact command match (but not file paths)
    if (input.startsWith("/") && !looksLikePath(input)) {
      const commands = getCommands();
      const exactMatch = commands.find(c => c.cmd === input);
      if (exactMatch) {
        isProcessing = true;
        await executeCommand(exactMatch);
        isProcessing = false;
        process.stdout.write('\n');
        showPrompt();
        return;
      }

      // Unknown command
      console.log(`  ${GRAY_DIM}Unknown command. Type${RESET} ${BLUE}/${RESET} ${GRAY_DIM}to see commands${RESET}\n`);
      showPrompt();
      return;
    }

    // Check if we're in team chat mode - handle non-command messages
    // (file paths starting with / should still go through as messages)
    if (ctx.chatType === 'team' && (!input.startsWith('/') || looksLikePath(input))) {
      // Handle @lisa to invoke AI in team chat
      if (input.toLowerCase().startsWith('@lisa ')) {
        const lisaPrompt = input.slice(6).trim();
        if (lisaPrompt) {
          isProcessing = true;

          // Show who's asking
          const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
          const sender = ctx.userEmail ? ctx.userEmail.split('@')[0] : 'You';
          console.log(`${BLUE}${sender}${RESET}  ${GRAY_DIM}${time}${RESET}`);
          console.log(`${input}`);
          console.log();

          // Save user message to team chat
          try {
            await sendTeamMessage(ctx.conversationId, input, true, lisaPrompt);
          } catch (err) {
            // Continue even if save fails
          }

          // Call Lisa AI and stream response
          const spinner = new Spinner("Lisa").run();
          try {
            const res = await sendTeamChatToLisa(lisaPrompt, ctx.conversationId);
            const aiResponse = await streamTeamResponse(res, spinner);

            // Save Lisa's response to team chat
            if (aiResponse) {
              await saveTeamAIResponse(ctx.conversationId, aiResponse);
            }
          } catch (err) {
            spinner.stop("Error", false);
            console.error(`${RED}Error: ${err.message}${RESET}\n`);
          }
          isProcessing = false;
          showPrompt();
          return;
        }
      }

      // Regular team chat message (not a command, not @lisa)
      isProcessing = true;
      try {
        await sendTeamMessage(ctx.conversationId, input, false);
        const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        const sender = ctx.userEmail ? ctx.userEmail.split('@')[0] : 'You';
        console.log(`${BLUE}${sender}${RESET}  ${GRAY_DIM}${time}${RESET}`);
        console.log(`${input}`);
        console.log();
      } catch (err) {
        console.error(`${RED}Error: ${err.message}${RESET}\n`);
      }
      isProcessing = false;
      showPrompt();
      return;
    }

    // Regular message to Lisa (AI mode) - not a command (but allow file paths)
    if (!input.startsWith('/') || looksLikePath(input)) {
      isProcessing = true;
      const spinner = new Spinner("Thinking").run();
      try {
        const res = await sendMessage(input);
        await streamResponse(res, input, spinner);
      } catch (err) {
        spinner.stop("Error", false);
        console.error(`${RED}Error: ${err.message}${RESET}\n`);
      }
      isProcessing = false;

      process.stdout.write('\n');
      showPrompt();
      return;
    }
  };

  // Send team chat message
  async function sendTeamMessage(conversationId, content, invokeAI = false, aiPrompt = null) {
    // Only include sender_id if it's a valid UUID (not "test")
    const isValidUUID = ctx.userId && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(ctx.userId);

    const messageData = {
      conversation_id: conversationId,
      role: "user",
      content: content,
      is_ai_invocation: invokeAI,
    };

    if (isValidUUID) {
      messageData.sender_id = ctx.userId;
    }
    if (aiPrompt) {
      messageData.ai_prompt = aiPrompt;
    }

    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/lisa_messages`,
      {
        method: "POST",
        headers: {
          "apikey": SERVICE_KEY,
          "Authorization": `Bearer ${SERVICE_KEY}`,
          "Content-Type": "application/json",
          "Prefer": "return=representation"
        },
        body: JSON.stringify(messageData)
      }
    );

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Failed to send message: ${err}`);
    }

    return res.json();
  }

  // Send message to Lisa AI for team chat
  async function sendTeamChatToLisa(message, conversationId) {
    const body = {
      store_id: ctx.storeId,
      message,
      history: [], // Team chat doesn't need history context - Lisa sees the conversation
      conversation_id: conversationId,
      chat_type: 'location', // Tell the agent this is a team chat
    };
    if (ctx.userId) body.user_id = ctx.userId;
    if (ctx.userEmail) body.user_email = ctx.userEmail;
    if (ctx.storeName) body.store_name = ctx.storeName;
    if (ctx.teamChatLocation?.locationId) body.location_id = ctx.teamChatLocation.locationId;
    if (ctx.teamChatLocation?.locationName) body.location_name = ctx.teamChatLocation.locationName;

    const token = ctx.auth?.accessToken || SERVICE_KEY;
    const res = await fetch(`${SUPABASE_URL}/functions/v1/agentic-loop`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "apikey": ANON_KEY,
        "Authorization": `Bearer ${token}`,
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) throw new Error(`API error: ${res.status}`);
    return res;
  }

  // Stream response for team chat (similar to streamResponse but returns the text)
  async function streamTeamResponse(response, existingSpinner = null) {
    let fullText = "";
    let lineBuffer = "";
    let spinner = existingSpinner;
    let textStarted = false;

    const formatLine = (line) => {
      return line
        .replace(/(\$[\d,]+(?:\.\d+)?)/g, `${GREEN}$1${RESET}`)
        .replace(/(\d+\.?\d*%)/g, `${GRAY}$1${RESET}`)
        .replace(/(\+[\d.]+%|\+\$[\d,]+)/g, `${GREEN}$1${RESET}`)
        .replace(/(-[\d.]+%|-\$[\d,]+)/g, `${RED}$1${RESET}`);
    };

    for await (const event of parseSSE(response)) {
      switch (event.type) {
        case "text":
          if (event.content) {
            if (!textStarted) {
              if (spinner) {
                spinner.stop("Lisa", true);
                spinner = null;
              }
              textStarted = true;
              const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
              console.log(`  ${GREEN}Lisa${RESET} ${GRAY_DIM}${time}${RESET}`);
            }

            lineBuffer += event.content;
            const lines = lineBuffer.split("\n");
            lineBuffer = lines.pop() || "";

            for (const line of lines) {
              console.log(`  ${formatLine(line)}`);
            }

            fullText += event.content;
          }
          break;

        case "tool_start":
          if (spinner) {
            spinner.stop(spinner.text, true);
            spinner = null;
          }
          const toolName = event.tool_name.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase());
          spinner = new Spinner(toolName).run();
          textStarted = false;
          break;

        case "tool_end":
          if (spinner) {
            spinner.stop(spinner.text, true);
            spinner = null;
          }
          break;

        case "error":
          if (spinner) spinner.stop("Error", false);
          console.error(`${RED}Error: ${event.message}${RESET}`);
          return null;
      }
    }

    // Output any remaining buffered text
    if (lineBuffer) {
      if (!textStarted) {
        const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        console.log(`  ${GREEN}Lisa${RESET} ${GRAY_DIM}${time}${RESET}`);
      }
      console.log(`  ${formatLine(lineBuffer)}`);
    }

    if (spinner) spinner.stop("Done", true);
    console.log();

    return fullText;
  }

  // Save Lisa's AI response to team chat
  async function saveTeamAIResponse(conversationId, content) {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/lisa_messages`,
      {
        method: "POST",
        headers: {
          "apikey": SERVICE_KEY,
          "Authorization": `Bearer ${SERVICE_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          conversation_id: conversationId,
          role: "assistant",
          content: content,
        })
      }
    );

    if (!res.ok) {
      console.error(`${GRAY_DIM}Warning: Could not save response to chat${RESET}`);
    }
  }

  // Setup raw mode for keypress handling
  emitKeypressEvents(process.stdin);
  if (process.stdin.isTTY) {
    process.stdin.setRawMode(true);
    // Disable bracketed paste mode (causes [ ] artifacts)
    process.stdout.write('\x1b[?2004l');
  }

  // Initial prompt
  process.stdout.write('\n');
  showPrompt();

  process.stdin.on("keypress", async (str, key) => {
    if (isProcessing) return;

    // Handle special keys
    if (key) {
      // Ctrl+C - if input exists, clear it; otherwise exit
      if (key.ctrl && key.name === "c") {
        if (inputBuffer.length > 0 || menuVisible || submenu.visible) {
          inputBuffer = "";
          prevInputRows = 1;
          closeMenu();
          closeSubmenu();
          render();
        } else {
          process.stdout.write('\r\x1b[J');
          console.log(`\n${DIM}Goodbye${RESET}\n`);
          process.exit(0);
        }
        return;
      }

      // Escape - close menus, then clear input
      if (key.name === "escape") {
        if (submenu.visible) {
          closeSubmenu();
          process.stdout.write('\r\x1b[J');
          showPrompt();
        } else if (menuVisible) {
          closeMenu();
          render();
        } else if (inputBuffer.length > 0) {
          inputBuffer = "";
          prevInputRows = 1;
          render();
        }
        return;
      }

      // Enter to submit
      if (key.name === "return") {
        await submit();
        return;
      }

      // Backspace
      if (key.name === "backspace") {
        if (inputBuffer.length > 0) {
          inputBuffer = inputBuffer.slice(0, -1);
          updateMenu();
          render();
        }
        return;
      }

      // Ctrl+U - clear entire line (like bash)
      if (key.ctrl && key.name === "u") {
        inputBuffer = "";
        prevInputRows = 1;
        closeMenu();
        render();
        return;
      }

      // Arrow up - navigate menu or submenu
      if (key.name === "up") {
        if (submenu.visible && submenu.items.length > 0) {
          submenu.index = Math.max(0, submenu.index - 1);
          render();
          return;
        }
        if (menuVisible && menuItems.length > 0) {
          menuIndex = Math.max(0, menuIndex - 1);
          render();
          return;
        }
      }

      // Arrow down - navigate menu or submenu
      if (key.name === "down") {
        if (submenu.visible && submenu.items.length > 0) {
          submenu.index = Math.min(submenu.items.length - 1, submenu.index + 1);
          render();
          return;
        }
        if (menuVisible && menuItems.length > 0) {
          menuIndex = Math.min(menuItems.length - 1, menuIndex + 1);
          render();
          return;
        }
      }

      // Tab - autocomplete/select if single match
      if (key.name === "tab" && menuVisible && menuItems.length === 1) {
        inputBuffer = menuItems[0].cmd;
        updateMenu();
        render();
        return;
      }
    }

    // Regular character input
    if (str && str.length === 1 && str.charCodeAt(0) >= 32) {
      // Close submenu if typing
      if (submenu.visible) {
        closeSubmenu();
        process.stdout.write('\r\x1b[J');
        showPrompt();
      }
      inputBuffer += str;
      updateMenu();
      render();
    }
  });

  // Handle close
  process.stdin.on("close", () => {
    process.exit(0);
  });
}

// =============================================================================
// Commands
// =============================================================================

async function loginCmd() {
  console.log(`\n${BOLD}Lisa Login${RESET}\n`);

  const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: false });
  const lines = [];

  await new Promise((resolve) => {
    process.stdout.write(`  Email: `);
    rl.on("line", (line) => {
      lines.push(line);
      if (lines.length === 1) process.stdout.write(`  Password: `);
      if (lines.length >= 2) { rl.close(); resolve(); }
    });
    rl.on("close", resolve);
  });

  const [email, password] = lines;
  if (!email || !password) {
    console.error(`${RED}Email and password required${RESET}\n`);
    process.exit(1);
  }

  console.log(`\n${DIM}Signing in...${RESET}`);

  try {
    const auth = await signIn(email, password);
    const store = await getUserStore(auth.user.id);
    if (!store) throw new Error("No store found");

    const locations = await getStoreLocations(auth.accessToken, store.storeId);

    saveAuth({ ...auth, storeId: store.storeId, storeName: store.storeName, role: store.role, locations });

    console.log(`\n${GREEN}✓${RESET} Logged in as ${auth.user.email}`);
    console.log(`${DIM}  Store: ${store.storeName}${RESET}`);
    if (locations.length) console.log(`${DIM}  Locations: ${locations.map(l => l.name).join(", ")}${RESET}`);
    console.log();
  } catch (err) {
    console.error(`\n${RED}✗ ${err.message}${RESET}\n`);
    process.exit(1);
  }
}

async function logoutCmd() {
  clearAuth();
  clearSession();
  console.log(`\n${GREEN}✓${RESET} Logged out\n`);
}

async function whoamiCmd() {
  const auth = loadAuth();
  if (!auth?.user) {
    console.log(`\n${DIM}Not logged in. Run: lisa login${RESET}\n`);
    return;
  }
  console.log(`\n${BOLD}Lisa${RESET}\n`);
  console.log(`  Email: ${auth.user.email}`);
  console.log(`  Store: ${auth.storeName || "Unknown"}`);
  console.log(`  Role:  ${auth.role || "Unknown"}`);
  if (auth.locations?.length) console.log(`  Locations: ${auth.locations.map(l => l.name).join(", ")}`);
  console.log();
}

// =============================================================================
// Parse Args
// =============================================================================

function parseArgs(argv) {
  const args = { message: [], help: false, version: false, newSession: false, location: null, dangerouslySkipPermissions: false };

  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "-h" || arg === "--help") args.help = true;
    else if (arg === "-v" || arg === "--version") args.version = true;
    else if (arg === "-n" || arg === "--new") args.newSession = true;
    else if (arg === "-l" || arg === "--location") args.location = argv[++i];
    else if (arg === "--dangerously-skip-permissions") args.dangerouslySkipPermissions = true;
    else if (!arg.startsWith("-")) args.message.push(arg);
  }

  args.message = args.message.join(" ");
  return args;
}

// =============================================================================
// Main
// =============================================================================

async function main() {
  const args = parseArgs(process.argv);

  if (args.help) {
    console.log(`
${BOLD}Lisa${RESET} v${VERSION}

${BOLD}Usage:${RESET}
  lisa                     Interactive mode
  lisa "question"          Ask a question
  lisa --new "question"    New conversation

${BOLD}Commands:${RESET}
  lisa login               Sign in
  lisa logout              Sign out
  lisa whoami              Show user info

${BOLD}Options:${RESET}
  -h, --help                        Show help
  -v, --version                     Show version
  -n, --new                         New conversation
  -l, --location NAME               Filter by location
  --dangerously-skip-permissions    Auto-approve dangerous operations
`);
    process.exit(0);
  }

  // Set dangerous mode from args
  ctx.dangerouslySkipPermissions = args.dangerouslySkipPermissions;

  if (args.version) {
    console.log(`Lisa v${VERSION}`);
    process.exit(0);
  }

  const cmd = args.message.toLowerCase();
  if (cmd === "login") { await loginCmd(); return; }
  if (cmd === "logout") { await logoutCmd(); return; }
  if (cmd === "whoami") { await whoamiCmd(); return; }

  const hasPrevious = await initSession(args);

  // Require login
  if (hasPrevious === null) {
    console.log();
    console.log(`  ${GRAY_DIM}Not logged in.${RESET}`);
    console.log(`  ${GRAY_DIM}Run${RESET} ${WHITE}lisa login${RESET} ${GRAY_DIM}to sign in.${RESET}`);
    console.log();
    process.exit(1);
  }

  if (!args.message) {
    await interactive(hasPrevious);
    return;
  }

  // Single query - show spinner immediately
  const spinner = new Spinner("Thinking").run();
  try {
    const res = await sendMessage(args.message);
    await streamResponse(res, args.message, spinner);
  } catch (err) {
    spinner.stop("Error", false);
    console.error(`${RED}Error: ${err.message}${RESET}\n`);
    process.exit(1);
  }
}

main().catch(err => {
  console.error(`${RED}Fatal: ${err.message}${RESET}`);
  process.exit(1);
});
