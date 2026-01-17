import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

// =============================================================================
// Configuration
// =============================================================================

// Default values (can be overridden by env vars or config file)
const DEFAULTS = {
  API_URL: 'https://uaednwpxursknmwdeejn.supabase.co',
  ANON_KEY: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVhZWRud3B4dXJza25td2RlZWpuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjA5OTcyMzMsImV4cCI6MjA3NjU3MzIzM30.N8jPwlyCBB5KJB5I-XaK6m-mq88rSR445AWFJJmwRCg',
  SERVICE_KEY: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVhZWRud3B4dXJza25td2RlZWpuIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2MDk5NzIzMywiZXhwIjoyMDc2NTczMjMzfQ.l0NvBbS2JQWPObtWeVD2M2LD866A2tgLmModARYNnbI',
};

interface Config {
  apiUrl: string;
  anonKey: string;
  serviceKey: string;
  storageDir: string;
  version: string;
}

function loadConfig(): Config {
  const storageDir = join(homedir(), '.wilson');
  const configFile = join(storageDir, 'config.json');

  // Try to load from config file
  let fileConfig: Partial<Config> = {};
  if (existsSync(configFile)) {
    try {
      fileConfig = JSON.parse(readFileSync(configFile, 'utf8'));
    } catch {
      // Ignore invalid config
    }
  }

  return {
    apiUrl: process.env.WILSON_API_URL || fileConfig.apiUrl || DEFAULTS.API_URL,
    anonKey: process.env.WILSON_ANON_KEY || fileConfig.anonKey || DEFAULTS.ANON_KEY,
    serviceKey: process.env.WILSON_SERVICE_KEY || fileConfig.serviceKey || DEFAULTS.SERVICE_KEY,
    storageDir,
    version: '1.0.0',
  };
}

export const config = loadConfig();
