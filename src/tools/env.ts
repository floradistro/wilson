import type { Tool, ToolResult } from '../types.js';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { homedir } from 'os';
import { join, dirname } from 'path';

interface AuthData {
  accessToken: string;
  refreshToken: string;
  storeId: string;
  storeName: string;
  user: { id: string; email: string };
}

/**
 * Load Wilson auth from ~/.wilson/auth.json
 */
function loadWilsonAuth(): AuthData | null {
  try {
    const authPath = join(homedir(), '.wilson', 'auth.json');
    if (existsSync(authPath)) {
      return JSON.parse(readFileSync(authPath, 'utf-8'));
    }
  } catch {
    // Ignore errors
  }
  return null;
}

/**
 * Load Wilson config for API URL and keys
 */
function loadWilsonConfig(): { apiUrl?: string; anonKey?: string; serviceKey?: string } {
  return {
    apiUrl: process.env.WILSON_API_URL,
    anonKey: process.env.WILSON_ANON_KEY,
    serviceKey: process.env.WILSON_SERVICE_KEY,
  };
}

/**
 * Parse existing .env file into key-value pairs
 */
function parseEnvFile(content: string): Map<string, string> {
  const env = new Map<string, string>();
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx > 0) {
      const key = trimmed.slice(0, eqIdx).trim();
      let value = trimmed.slice(eqIdx + 1).trim();
      // Remove quotes
      if ((value.startsWith('"') && value.endsWith('"')) ||
          (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      env.set(key, value);
    }
  }
  return env;
}

/**
 * Format env map back to .env file content
 */
function formatEnvFile(env: Map<string, string>, comments?: Map<string, string>): string {
  const lines: string[] = [];
  for (const [key, value] of env) {
    // Add comment if exists
    if (comments?.has(key)) {
      lines.push(`# ${comments.get(key)}`);
    }
    // Quote values with spaces or special chars
    const needsQuotes = /[\s#$]/.test(value);
    lines.push(`${key}=${needsQuotes ? `"${value}"` : value}`);
  }
  return lines.join('\n') + '\n';
}

export const EnvSchema = {
  name: 'Env',
  description: 'Wire up a project with Supabase/Wilson credentials. Creates or updates .env files with proper authentication.',
  parameters: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'Path to .env file or project directory (default: current dir)' },
      framework: {
        type: 'string',
        enum: ['nextjs', 'react', 'vue', 'nuxt', 'expo', 'node', 'auto'],
        description: 'Framework to configure for (auto-detects if not specified)',
      },
      include_service_key: { type: 'boolean', description: 'Include service role key (for server-side only)' },
      dry_run: { type: 'boolean', description: 'Show what would be written without making changes' },
    },
    required: [],
  },
};

/**
 * Env tool - wire up projects with Supabase credentials
 */
export const envTool: Tool = {
  schema: EnvSchema,

  async execute(params: Record<string, unknown>): Promise<ToolResult> {
    const {
      path: inputPath = process.cwd(),
      framework = 'auto',
      include_service_key = false,
      dry_run = false,
    } = params as {
      path?: string;
      framework?: string;
      include_service_key?: boolean;
      dry_run?: boolean;
    };

    // Load Wilson auth and config
    const auth = loadWilsonAuth();
    const config = loadWilsonConfig();

    if (!auth) {
      return {
        success: false,
        error: 'Not authenticated. Run Wilson and login first.',
      };
    }

    if (!config.apiUrl || !config.anonKey) {
      return {
        success: false,
        error: 'Wilson not configured. Missing WILSON_API_URL or WILSON_ANON_KEY.',
      };
    }

    // Determine target path
    let envPath = inputPath;
    if (!envPath.endsWith('.env') && !envPath.includes('.env.')) {
      // It's a directory, detect the right .env file
      const detected = detectFramework(inputPath);
      envPath = join(inputPath, detected.envFile);
    }

    // Detect framework if auto
    let detectedFramework = framework;
    if (framework === 'auto') {
      const detected = detectFramework(dirname(envPath));
      detectedFramework = detected.framework;
    }

    // Build environment variables based on framework
    const envVars = new Map<string, string>();
    const comments = new Map<string, string>();

    // Common Supabase vars (Next.js style)
    if (['nextjs', 'react', 'nuxt', 'vue', 'auto'].includes(detectedFramework)) {
      const prefix = detectedFramework === 'nuxt' ? 'NUXT_PUBLIC_' :
                     detectedFramework === 'vue' ? 'VITE_' :
                     'NEXT_PUBLIC_';

      envVars.set(`${prefix}SUPABASE_URL`, config.apiUrl);
      envVars.set(`${prefix}SUPABASE_ANON_KEY`, config.anonKey);
      comments.set(`${prefix}SUPABASE_URL`, 'Supabase project URL');
      comments.set(`${prefix}SUPABASE_ANON_KEY`, 'Supabase anonymous key (safe for browser)');

      // Server-side vars - DISABLED for security
      // Service role key should NEVER be in client apps
      // Users should call your edge functions instead
      if (include_service_key && config.serviceKey) {
        // DON'T include service key - too dangerous
        // Instead, add a comment explaining the secure pattern
        envVars.set('# SUPABASE_SERVICE_ROLE_KEY', 'DO_NOT_USE_IN_CLIENT_APPS');
        comments.set('# SUPABASE_SERVICE_ROLE_KEY', 'Use edge functions for admin operations instead');
      }

      // Store info
      envVars.set(`${prefix}STORE_ID`, auth.storeId);
      comments.set(`${prefix}STORE_ID`, `Store: ${auth.storeName}`);
    }

    // Node.js style (no prefix)
    if (['node', 'expo'].includes(detectedFramework)) {
      envVars.set('SUPABASE_URL', config.apiUrl);
      envVars.set('SUPABASE_ANON_KEY', config.anonKey);
      envVars.set('STORE_ID', auth.storeId);

      if (include_service_key && config.serviceKey) {
        envVars.set('SUPABASE_SERVICE_ROLE_KEY', config.serviceKey);
      }
    }

    // Add user auth token for authenticated requests
    envVars.set('SUPABASE_AUTH_TOKEN', auth.accessToken);
    comments.set('SUPABASE_AUTH_TOKEN', `User: ${auth.user.email} (expires, refresh with Wilson)`);

    // Read existing .env if present
    let existingEnv = new Map<string, string>();
    if (existsSync(envPath)) {
      try {
        existingEnv = parseEnvFile(readFileSync(envPath, 'utf-8'));
      } catch {
        // Ignore read errors
      }
    }

    // Merge: new vars override existing
    const mergedEnv = new Map([...existingEnv, ...envVars]);

    // Generate content
    const content = formatEnvFile(mergedEnv, comments);

    if (dry_run) {
      return {
        success: true,
        content: `Would write to ${envPath}:\n\n${content}`,
        summary: `Dry run: ${envVars.size} variables for ${detectedFramework}`,
      };
    }

    // Check .gitignore includes .env files
    const gitignorePath = join(dirname(envPath), '.gitignore');
    let gitignoreWarning = '';
    try {
      if (existsSync(gitignorePath)) {
        const gitignore = readFileSync(gitignorePath, 'utf-8');
        const envFileName = envPath.split('/').pop() || '.env';
        if (!gitignore.includes('.env') && !gitignore.includes(envFileName)) {
          gitignoreWarning = `\n⚠️  WARNING: Add "${envFileName}" to .gitignore to prevent credential leaks!`;
        }
      } else {
        gitignoreWarning = '\n⚠️  WARNING: No .gitignore found. Create one and add .env* to prevent credential leaks!';
      }
    } catch {
      // Ignore gitignore check errors
    }

    // Write the file
    try {
      writeFileSync(envPath, content, 'utf-8');

      const securityNote = `
🔒 Security Notes:
• These credentials are for DEVELOPMENT only
• Access token expires - re-run Wilson to refresh
• Never commit .env files to git
• For production, use proper OAuth/session management`;

      return {
        success: true,
        content: `Updated ${envPath} with ${envVars.size} credentials${gitignoreWarning}\n${securityNote}`,
        summary: `Configured ${detectedFramework} project for ${auth.storeName}`,
        details: {
          path: envPath,
          framework: detectedFramework,
          variables: Array.from(envVars.keys()),
          store: auth.storeName,
        },
      };
    } catch (error) {
      return {
        success: false,
        error: `Failed to write ${envPath}: ${error instanceof Error ? error.message : 'Unknown error'}`,
      };
    }
  },
};

/**
 * Detect framework from project files
 */
function detectFramework(dir: string): { framework: string; envFile: string } {
  try {
    // Check for framework-specific files
    if (existsSync(join(dir, 'next.config.js')) || existsSync(join(dir, 'next.config.mjs')) || existsSync(join(dir, 'next.config.ts'))) {
      return { framework: 'nextjs', envFile: '.env.local' };
    }
    if (existsSync(join(dir, 'nuxt.config.ts')) || existsSync(join(dir, 'nuxt.config.js'))) {
      return { framework: 'nuxt', envFile: '.env' };
    }
    if (existsSync(join(dir, 'vite.config.ts')) || existsSync(join(dir, 'vite.config.js'))) {
      return { framework: 'vue', envFile: '.env.local' };
    }
    if (existsSync(join(dir, 'app.json')) && existsSync(join(dir, 'metro.config.js'))) {
      return { framework: 'expo', envFile: '.env' };
    }
    if (existsSync(join(dir, 'package.json'))) {
      try {
        const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf-8'));
        if (pkg.dependencies?.next) return { framework: 'nextjs', envFile: '.env.local' };
        if (pkg.dependencies?.nuxt) return { framework: 'nuxt', envFile: '.env' };
        if (pkg.dependencies?.vue || pkg.dependencies?.vite) return { framework: 'vue', envFile: '.env.local' };
        if (pkg.dependencies?.expo) return { framework: 'expo', envFile: '.env' };
        if (pkg.dependencies?.react) return { framework: 'react', envFile: '.env.local' };
      } catch {
        // Ignore parse errors
      }
    }
  } catch {
    // Ignore errors
  }

  return { framework: 'node', envFile: '.env' };
}

/**
 * Get credentials for injecting into bash commands.
 * NOTE: Does NOT include service role key - that should only be used server-side.
 */
export function getSupabaseEnv(): Record<string, string> {
  const auth = loadWilsonAuth();
  const config = loadWilsonConfig();

  const env: Record<string, string> = {};

  if (config.apiUrl) {
    env.SUPABASE_URL = config.apiUrl;
    env.NEXT_PUBLIC_SUPABASE_URL = config.apiUrl;
    env.VITE_SUPABASE_URL = config.apiUrl;
  }
  if (config.anonKey) {
    env.SUPABASE_ANON_KEY = config.anonKey;
    env.NEXT_PUBLIC_SUPABASE_ANON_KEY = config.anonKey;
    env.VITE_SUPABASE_ANON_KEY = config.anonKey;
  }
  // SECURITY: Never inject service role key into child processes
  // Users should call edge functions for admin operations
  if (auth) {
    env.STORE_ID = auth.storeId;
    env.NEXT_PUBLIC_STORE_ID = auth.storeId;
    // User's auth token for authenticated requests
    env.SUPABASE_AUTH_TOKEN = auth.accessToken;
  }

  return env;
}
