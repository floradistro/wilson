import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

// =============================================================================
// Configuration - Keys loaded from environment variables only
// =============================================================================

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

  // Try to load from config file (for user overrides)
  let fileConfig: Partial<Config> = {};
  if (existsSync(configFile)) {
    try {
      fileConfig = JSON.parse(readFileSync(configFile, 'utf8'));
    } catch {
      // Ignore invalid config
    }
  }

  // Environment variables take precedence, then config file
  const apiUrl = process.env.WILSON_API_URL || fileConfig.apiUrl;
  const anonKey = process.env.WILSON_ANON_KEY || fileConfig.anonKey;
  const serviceKey = process.env.WILSON_SERVICE_KEY || fileConfig.serviceKey;

  // Validate required config
  if (!apiUrl || !anonKey) {
    console.error('Missing required configuration. Set WILSON_API_URL and WILSON_ANON_KEY environment variables.');
    console.error('Or create ~/.wilson/config.json with apiUrl and anonKey.');
    process.exit(1);
  }

  return {
    apiUrl,
    anonKey,
    serviceKey: serviceKey || '',
    storageDir,
    version: '1.1.0',
  };
}

export const config = loadConfig();
