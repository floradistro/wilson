import { existsSync, mkdirSync, readFileSync, writeFileSync, unlinkSync } from 'fs';
import { join, dirname } from 'path';
import type { Symbol, SymbolIndex } from './symbols.js';
import type { FileInfo, ScanResult } from './scanner.js';
import type { SemanticIndex } from './embeddings.js';

// =============================================================================
// Local Index Storage
// Uses JSON files - simple and portable
// =============================================================================

export interface IndexMetadata {
  version: number;
  createdAt: number;
  updatedAt: number;
  rootPath: string;
  fileCount: number;
  symbolCount: number;
  chunkCount: number;
}

export interface StoredIndex {
  metadata: IndexMetadata;
  files: FileInfo[];
  symbols: Symbol[];
  semanticData?: string; // Serialized SemanticIndex
}

const INDEX_VERSION = 1;
const INDEX_DIR = '.wilson';
const INDEX_FILE = 'index.json';

// Get index path for a project
export function getIndexPath(projectRoot: string): string {
  return join(projectRoot, INDEX_DIR, INDEX_FILE);
}

// Check if index exists
export function indexExists(projectRoot: string): boolean {
  return existsSync(getIndexPath(projectRoot));
}

// Load index from disk
export function loadIndex(projectRoot: string): StoredIndex | null {
  const indexPath = getIndexPath(projectRoot);

  if (!existsSync(indexPath)) {
    return null;
  }

  try {
    const data = readFileSync(indexPath, 'utf8');
    const parsed = JSON.parse(data);

    // Check version compatibility
    if (parsed.metadata?.version !== INDEX_VERSION) {
      console.warn('Index version mismatch, needs rebuild');
      return null;
    }

    return parsed as StoredIndex;
  } catch (err) {
    console.error('Failed to load index:', err);
    return null;
  }
}

// Save index to disk
export function saveIndex(projectRoot: string, index: StoredIndex): boolean {
  const indexPath = getIndexPath(projectRoot);
  const indexDir = dirname(indexPath);

  try {
    // Ensure directory exists
    if (!existsSync(indexDir)) {
      mkdirSync(indexDir, { recursive: true });
    }

    // Write index
    writeFileSync(indexPath, JSON.stringify(index, null, 2));

    // Add to .gitignore if not already there
    addToGitignore(projectRoot, INDEX_DIR);

    return true;
  } catch (err) {
    console.error('Failed to save index:', err);
    return false;
  }
}

// Delete index
export function deleteIndex(projectRoot: string): boolean {
  const indexPath = getIndexPath(projectRoot);

  if (!existsSync(indexPath)) {
    return true;
  }

  try {
    unlinkSync(indexPath);
    return true;
  } catch (err) {
    console.error('Failed to delete index:', err);
    return false;
  }
}

// Add directory to .gitignore
function addToGitignore(projectRoot: string, entry: string): void {
  const gitignorePath = join(projectRoot, '.gitignore');

  try {
    let content = '';
    if (existsSync(gitignorePath)) {
      content = readFileSync(gitignorePath, 'utf8');
    }

    // Check if already present
    const lines = content.split('\n');
    if (lines.some(line => line.trim() === entry || line.trim() === `/${entry}`)) {
      return;
    }

    // Add entry
    const newContent = content.endsWith('\n') ? content : content + '\n';
    writeFileSync(gitignorePath, newContent + `${entry}\n`);
  } catch {
    // Ignore errors - not critical
  }
}

// =============================================================================
// Index Building Helpers
// =============================================================================

export function createIndexMetadata(
  rootPath: string,
  fileCount: number,
  symbolCount: number,
  chunkCount: number
): IndexMetadata {
  const now = Date.now();
  return {
    version: INDEX_VERSION,
    createdAt: now,
    updatedAt: now,
    rootPath,
    fileCount,
    symbolCount,
    chunkCount,
  };
}

// Check if file needs re-indexing based on modification time
export function needsReindex(
  storedFile: FileInfo | undefined,
  currentModTime: number
): boolean {
  if (!storedFile) return true;
  return currentModTime > storedFile.modifiedAt;
}

// Get files that changed since last index
export function getChangedFiles(
  stored: StoredIndex | null,
  current: ScanResult
): { added: FileInfo[]; modified: FileInfo[]; removed: string[] } {
  if (!stored) {
    return {
      added: current.files,
      modified: [],
      removed: [],
    };
  }

  const storedMap = new Map(stored.files.map(f => [f.path, f]));
  const currentMap = new Map(current.files.map(f => [f.path, f]));

  const added: FileInfo[] = [];
  const modified: FileInfo[] = [];
  const removed: string[] = [];

  // Check for added and modified
  for (const [path, file] of currentMap) {
    const storedFile = storedMap.get(path);
    if (!storedFile) {
      added.push(file);
    } else if (needsReindex(storedFile, file.modifiedAt)) {
      modified.push(file);
    }
  }

  // Check for removed
  for (const [path] of storedMap) {
    if (!currentMap.has(path)) {
      removed.push(path);
    }
  }

  return { added, modified, removed };
}

// =============================================================================
// Quick Search Utilities
// =============================================================================

// Build in-memory indexes from stored data
export function buildSymbolIndex(symbols: Symbol[]): SymbolIndex {
  const byName = new Map<string, Symbol[]>();
  const byFile = new Map<string, Symbol[]>();
  const byKind = new Map<string, Symbol[]>();

  for (const symbol of symbols) {
    // By name
    const nameList = byName.get(symbol.name) || [];
    nameList.push(symbol);
    byName.set(symbol.name, nameList);

    // By file
    const fileList = byFile.get(symbol.file) || [];
    fileList.push(symbol);
    byFile.set(symbol.file, fileList);

    // By kind
    const kindList = byKind.get(symbol.kind) || [];
    kindList.push(symbol);
    byKind.set(symbol.kind, kindList);
  }

  return {
    symbols,
    byName,
    byFile,
    byKind: byKind as Map<import('./symbols.js').SymbolKind, Symbol[]>,
  };
}

// Quick file search by pattern
export function searchFiles(
  files: FileInfo[],
  pattern: string
): FileInfo[] {
  const lower = pattern.toLowerCase();
  return files.filter(f =>
    f.name.toLowerCase().includes(lower) ||
    f.path.toLowerCase().includes(lower)
  );
}

// Quick symbol search by name
export function searchSymbolsByName(
  symbols: Symbol[],
  query: string
): Symbol[] {
  const lower = query.toLowerCase();
  return symbols
    .filter(s => s.name.toLowerCase().includes(lower))
    .sort((a, b) => {
      // Exact matches first
      const aExact = a.name.toLowerCase() === lower;
      const bExact = b.name.toLowerCase() === lower;
      if (aExact !== bExact) return aExact ? -1 : 1;

      // Starts with matches second
      const aStarts = a.name.toLowerCase().startsWith(lower);
      const bStarts = b.name.toLowerCase().startsWith(lower);
      if (aStarts !== bStarts) return aStarts ? -1 : 1;

      return a.name.localeCompare(b.name);
    });
}
