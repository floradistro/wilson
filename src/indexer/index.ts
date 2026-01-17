import { readFileSync } from 'fs';
import { relative } from 'path';
import { scanDirectory, isCodeFile, type ScanResult, type FileInfo } from './scanner.js';
import { extractSymbols, buildSymbolIndex, searchSymbols, type Symbol, type SymbolIndex } from './symbols.js';
import {
  chunkCode,
  buildSemanticIndex,
  searchSemanticIndex,
  serializeSemanticIndex,
  deserializeSemanticIndex,
  type SemanticIndex,
  type SearchResult,
} from './embeddings.js';
import {
  loadIndex,
  saveIndex,
  deleteIndex,
  indexExists,
  getChangedFiles,
  createIndexMetadata,
  searchFiles,
  searchSymbolsByName,
  type StoredIndex,
} from './store.js';

// =============================================================================
// Main Indexer API
// =============================================================================

export interface IndexStats {
  fileCount: number;
  symbolCount: number;
  chunkCount: number;
  lastUpdated: Date;
}

export interface CodebaseIndex {
  projectRoot: string;
  scan: ScanResult;
  symbols: Symbol[];
  symbolIndex: SymbolIndex;
  semanticIndex: SemanticIndex | null;
  stats: IndexStats;
}

// Build or update index for a project
export async function buildIndex(
  projectRoot: string,
  options: {
    includeSemantics?: boolean;
    forceRebuild?: boolean;
    onProgress?: (message: string) => void;
  } = {}
): Promise<CodebaseIndex> {
  const { includeSemantics = true, forceRebuild = false, onProgress } = options;
  const log = onProgress || (() => {});

  log('Scanning directory...');
  const scan = scanDirectory(projectRoot, { codeOnly: true });
  log(`Found ${scan.files.length} code files`);

  // Check for existing index
  let stored = forceRebuild ? null : loadIndex(projectRoot);
  const changes = getChangedFiles(stored, scan);

  const hasChanges = changes.added.length > 0 || changes.modified.length > 0 || changes.removed.length > 0;

  if (stored && !hasChanges) {
    log('Index is up to date');
    return rebuildFromStored(projectRoot, stored, scan);
  }

  // Extract symbols
  log('Extracting symbols...');
  const allSymbols: Symbol[] = [];

  // Reuse existing symbols for unchanged files
  if (stored) {
    const changedPaths = new Set([
      ...changes.added.map(f => f.path),
      ...changes.modified.map(f => f.path),
      ...changes.removed,
    ]);

    for (const symbol of stored.symbols) {
      const relativePath = relative(projectRoot, symbol.file);
      if (!changedPaths.has(relativePath) && !changedPaths.has(symbol.file)) {
        allSymbols.push(symbol);
      }
    }
  }

  // Extract symbols from new/modified files
  const filesToProcess = [...changes.added, ...changes.modified];
  for (const file of filesToProcess) {
    try {
      const symbols = extractSymbols(file.absolutePath);
      allSymbols.push(...symbols);
    } catch {
      // Skip files that fail to parse
    }
  }

  log(`Extracted ${allSymbols.length} symbols`);

  // Build semantic index if requested
  let semanticIndex: SemanticIndex | null = null;
  let chunkCount = 0;

  if (includeSemantics) {
    log('Building semantic index...');
    const allChunks: Array<{ text: string; file: string; startLine: number; endLine: number }> = [];

    for (const file of scan.files) {
      try {
        const content = readFileSync(file.absolutePath, 'utf8');
        const chunks = chunkCode(content, file.path);
        allChunks.push(...chunks);
      } catch {
        // Skip files that fail to read
      }
    }

    chunkCount = allChunks.length;
    log(`Created ${chunkCount} chunks`);

    if (allChunks.length > 0) {
      semanticIndex = buildSemanticIndex(allChunks);
    }
  }

  // Build symbol index
  const symbolIndex = buildSymbolIndex(allSymbols);

  // Save to disk
  log('Saving index...');
  const storedIndex: StoredIndex = {
    metadata: createIndexMetadata(projectRoot, scan.files.length, allSymbols.length, chunkCount),
    files: scan.files,
    symbols: allSymbols,
    semanticData: semanticIndex ? serializeSemanticIndex(semanticIndex) : undefined,
  };

  saveIndex(projectRoot, storedIndex);
  log('Index saved');

  return {
    projectRoot,
    scan,
    symbols: allSymbols,
    symbolIndex,
    semanticIndex,
    stats: {
      fileCount: scan.files.length,
      symbolCount: allSymbols.length,
      chunkCount,
      lastUpdated: new Date(),
    },
  };
}

// Rebuild in-memory index from stored data
function rebuildFromStored(
  projectRoot: string,
  stored: StoredIndex,
  scan: ScanResult
): CodebaseIndex {
  const symbolIndex = buildSymbolIndex(stored.symbols);
  const semanticIndex = stored.semanticData
    ? deserializeSemanticIndex(stored.semanticData)
    : null;

  return {
    projectRoot,
    scan,
    symbols: stored.symbols,
    symbolIndex,
    semanticIndex,
    stats: {
      fileCount: stored.metadata.fileCount,
      symbolCount: stored.metadata.symbolCount,
      chunkCount: stored.metadata.chunkCount,
      lastUpdated: new Date(stored.metadata.updatedAt),
    },
  };
}

// Load existing index or return null
export function loadExistingIndex(projectRoot: string): CodebaseIndex | null {
  const stored = loadIndex(projectRoot);
  if (!stored) return null;

  const scan = scanDirectory(projectRoot, { codeOnly: true });
  return rebuildFromStored(projectRoot, stored, scan);
}

// Clear index for a project
export function clearIndex(projectRoot: string): boolean {
  return deleteIndex(projectRoot);
}

// Check if project has an index
export function hasIndex(projectRoot: string): boolean {
  return indexExists(projectRoot);
}

// =============================================================================
// Search API
// =============================================================================

export interface UnifiedSearchResult {
  type: 'file' | 'symbol' | 'semantic';
  name: string;
  file: string;
  line?: number;
  preview?: string;
  score?: number;
  metadata?: Record<string, unknown>;
}

// Unified search across all index types
export function search(
  index: CodebaseIndex,
  query: string,
  options: {
    types?: Array<'file' | 'symbol' | 'semantic'>;
    limit?: number;
  } = {}
): UnifiedSearchResult[] {
  const { types = ['file', 'symbol', 'semantic'], limit = 20 } = options;
  const results: UnifiedSearchResult[] = [];

  // File search
  if (types.includes('file')) {
    const fileResults = searchFiles(index.scan.files, query);
    for (const file of fileResults.slice(0, limit)) {
      results.push({
        type: 'file',
        name: file.name,
        file: file.path,
        metadata: { size: file.size, extension: file.extension },
      });
    }
  }

  // Symbol search
  if (types.includes('symbol')) {
    const symbolResults = searchSymbols(index.symbolIndex, query);
    for (const symbol of symbolResults.slice(0, limit)) {
      results.push({
        type: 'symbol',
        name: symbol.name,
        file: symbol.file,
        line: symbol.line,
        preview: symbol.signature,
        metadata: { kind: symbol.kind, exported: symbol.exported, parent: symbol.parent },
      });
    }
  }

  // Semantic search
  if (types.includes('semantic') && index.semanticIndex) {
    const semanticResults = searchSemanticIndex(index.semanticIndex, query, limit);
    for (const result of semanticResults) {
      results.push({
        type: 'semantic',
        name: `${result.file}:${result.startLine}-${result.endLine}`,
        file: result.file,
        line: result.startLine,
        preview: result.text.slice(0, 200),
        score: result.score,
      });
    }
  }

  // Sort by relevance (symbols and files first, then semantic by score)
  results.sort((a, b) => {
    // Prioritize exact name matches
    const aExact = a.name.toLowerCase() === query.toLowerCase();
    const bExact = b.name.toLowerCase() === query.toLowerCase();
    if (aExact !== bExact) return aExact ? -1 : 1;

    // Then by type priority
    const typePriority = { symbol: 0, file: 1, semantic: 2 };
    const typeDiff = typePriority[a.type] - typePriority[b.type];
    if (typeDiff !== 0) return typeDiff;

    // Then by score for semantic
    if (a.type === 'semantic' && b.type === 'semantic') {
      return (b.score || 0) - (a.score || 0);
    }

    return 0;
  });

  return results.slice(0, limit);
}

// Quick symbol lookup by exact name
export function lookupSymbol(index: CodebaseIndex, name: string): Symbol[] {
  return index.symbolIndex.byName.get(name) || [];
}

// Get symbols in a file
export function getFileSymbols(index: CodebaseIndex, filePath: string): Symbol[] {
  return index.symbolIndex.byFile.get(filePath) || [];
}

// Get all symbols of a kind
export function getSymbolsByKind(index: CodebaseIndex, kind: string): Symbol[] {
  return index.symbolIndex.byKind.get(kind as import('./symbols.js').SymbolKind) || [];
}

// =============================================================================
// Exports
// =============================================================================

export { scanDirectory, isCodeFile } from './scanner.js';
export { extractSymbols, buildSymbolIndex as buildSymbolIndexFromSymbols } from './symbols.js';
export type { Symbol, SymbolKind, SymbolIndex } from './symbols.js';
export type { FileInfo, ScanResult } from './scanner.js';
export type { SemanticIndex, SearchResult } from './embeddings.js';
