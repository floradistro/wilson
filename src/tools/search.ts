import type { Tool, ToolResult } from '../types.js';
import {
  buildIndex,
  loadExistingIndex,
  hasIndex,
  search,
  lookupSymbol,
  getSymbolsByKind,
  type CodebaseIndex,
} from '../indexer/index.js';

// Cache the index in memory
let cachedIndex: CodebaseIndex | null = null;
let cachedRoot: string | null = null;

// =============================================================================
// Index Tool - Build or update the codebase index
// =============================================================================

export const IndexSchema = {
  name: 'Index',
  description: 'Build or update the codebase index for faster search. Run once at the start of a project.',
  parameters: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'Project root directory (default: cwd)' },
      force: { type: 'boolean', description: 'Force full rebuild (default: false)' },
    },
    required: [],
  },
};

// Timeout for index building (10 seconds)
const INDEX_TIMEOUT = 10000;

export const indexTool: Tool = {
  schema: IndexSchema,

  async execute(params: Record<string, unknown>): Promise<ToolResult> {
    const path = (params.path as string) || process.cwd();
    const force = params.force as boolean || false;

    try {
      const logs: string[] = [];

      // Build index with timeout to prevent hangs
      const indexPromise = buildIndex(path, {
        includeSemantics: false, // Disabled - too slow and causes hangs
        forceRebuild: force,
        onProgress: (msg) => logs.push(msg),
      });

      const timeoutPromise = new Promise<null>((resolve) =>
        setTimeout(() => resolve(null), INDEX_TIMEOUT)
      );

      const result = await Promise.race([indexPromise, timeoutPromise]);

      if (!result) {
        return {
          success: false,
          error: `Index timed out after ${INDEX_TIMEOUT / 1000}s. Project may be too large or have complex files.`,
        };
      }

      cachedIndex = result;
      cachedRoot = path;

      return {
        success: true,
        content: [
          `Indexed ${cachedIndex.stats.fileCount} files`,
          `Found ${cachedIndex.stats.symbolCount} symbols`,
          '',
          ...logs.slice(-5), // Only last 5 log lines
        ].join('\n'),
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to build index',
      };
    }
  },
};

// =============================================================================
// Search Tool - Search the codebase
// =============================================================================

export const SearchSchema = {
  name: 'Search',
  description: 'Search the indexed codebase. Finds files, symbols, and semantic matches.',
  parameters: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'Search query' },
      type: {
        type: 'string',
        enum: ['all', 'file', 'symbol', 'semantic'],
        description: "Search type: 'all', 'file', 'symbol', or 'semantic' (default: 'all')",
      },
      kind: {
        type: 'string',
        enum: ['function', 'class', 'interface', 'type', 'method', 'variable'],
        description: 'Filter symbols by kind (only for symbol search)',
      },
      limit: { type: 'number', description: 'Max results (default: 20)' },
    },
    required: ['query'],
  },
};

export const searchTool: Tool = {
  schema: SearchSchema,

  async execute(params: Record<string, unknown>): Promise<ToolResult> {
    const query = params.query as string;
    const type = (params.type as string) || 'all';
    const kind = params.kind as string | undefined;
    const limit = (params.limit as number) || 20;

    if (!query) {
      return { success: false, error: 'Missing query' };
    }

    try {
      // Load or use cached index
      const index = await getIndex();
      if (!index) {
        return {
          success: false,
          error: 'No index found. Run Index tool first to build the codebase index.',
        };
      }

      // If searching by symbol kind
      if (kind && type === 'symbol') {
        const symbols = getSymbolsByKind(index, kind);
        const filtered = symbols
          .filter(s => s.name.toLowerCase().includes(query.toLowerCase()))
          .slice(0, limit);

        return {
          success: true,
          content: formatSymbolResults(filtered),
        };
      }

      // General search
      const types: Array<'file' | 'symbol' | 'semantic'> =
        type === 'all' ? ['file', 'symbol', 'semantic'] :
        type === 'file' ? ['file'] :
        type === 'symbol' ? ['symbol'] :
        type === 'semantic' ? ['semantic'] :
        ['file', 'symbol', 'semantic'];

      const results = search(index, query, { types, limit });

      if (results.length === 0) {
        return {
          success: true,
          content: `No results found for "${query}"`,
        };
      }

      return {
        success: true,
        content: formatSearchResults(results),
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Search failed',
      };
    }
  },
};

// =============================================================================
// Symbol Tool - Lookup a specific symbol
// =============================================================================

export const SymbolSchema = {
  name: 'Symbol',
  description: 'Look up a specific symbol (function, class, etc.) by exact name.',
  parameters: {
    type: 'object',
    properties: {
      name: { type: 'string', description: 'Symbol name to look up' },
    },
    required: ['name'],
  },
};

export const symbolTool: Tool = {
  schema: SymbolSchema,

  async execute(params: Record<string, unknown>): Promise<ToolResult> {
    const name = params.name as string;

    if (!name) {
      return { success: false, error: 'Missing symbol name' };
    }

    try {
      const index = await getIndex();
      if (!index) {
        return {
          success: false,
          error: 'No index found. Run Index tool first.',
        };
      }

      const symbols = lookupSymbol(index, name);

      if (symbols.length === 0) {
        return {
          success: true,
          content: `No symbol found with name "${name}"`,
        };
      }

      return {
        success: true,
        content: formatSymbolResults(symbols),
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Symbol lookup failed',
      };
    }
  },
};

// =============================================================================
// Helpers
// =============================================================================

async function getIndex(): Promise<CodebaseIndex | null> {
  const cwd = process.cwd();

  // Return cached if same directory
  if (cachedIndex && cachedRoot === cwd) {
    return cachedIndex;
  }

  // Try to load existing index
  if (hasIndex(cwd)) {
    cachedIndex = loadExistingIndex(cwd);
    cachedRoot = cwd;
    return cachedIndex;
  }

  return null;
}

function formatSearchResults(results: Array<{
  type: string;
  name: string;
  file: string;
  line?: number;
  preview?: string;
  score?: number;
}>): string {
  const lines: string[] = [];

  for (const r of results) {
    const location = r.line ? `${r.file}:${r.line}` : r.file;
    const typeTag = `[${r.type}]`;
    const scorePart = r.score ? ` (${(r.score * 100).toFixed(0)}%)` : '';

    lines.push(`${typeTag} ${r.name}`);
    lines.push(`  ${location}${scorePart}`);

    if (r.preview) {
      const preview = r.preview.slice(0, 100).replace(/\n/g, ' ');
      lines.push(`  ${preview}`);
    }
    lines.push('');
  }

  return lines.join('\n');
}

function formatSymbolResults(symbols: Array<{
  name: string;
  kind: string;
  file: string;
  line: number;
  signature?: string;
  exported: boolean;
  parent?: string;
}>): string {
  const lines: string[] = [];

  for (const s of symbols) {
    const exp = s.exported ? 'export ' : '';
    const parent = s.parent ? ` (in ${s.parent})` : '';

    lines.push(`${exp}${s.kind} ${s.name}${parent}`);
    lines.push(`  ${s.file}:${s.line}`);

    if (s.signature) {
      lines.push(`  ${s.signature.slice(0, 80)}`);
    }
    lines.push('');
  }

  return lines.join('\n');
}
