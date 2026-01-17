import { readdirSync, statSync, readFileSync, existsSync } from 'fs';
import { join, relative, extname } from 'path';
import ignore from 'ignore';

export interface FileInfo {
  path: string;           // Relative path from root
  absolutePath: string;   // Full path
  name: string;           // File name
  extension: string;      // File extension
  size: number;           // Size in bytes
  modifiedAt: number;     // Last modified timestamp
  type: 'file' | 'directory';
}

export interface ScanResult {
  root: string;
  files: FileInfo[];
  directories: string[];
  totalFiles: number;
  totalSize: number;
  scannedAt: number;
}

// Default ignore patterns (always ignore these)
const DEFAULT_IGNORES = [
  'node_modules',
  '.git',
  '.next',
  '.nuxt',
  'dist',
  'build',
  '.cache',
  '.turbo',
  'coverage',
  '.nyc_output',
  '*.log',
  '.DS_Store',
  'Thumbs.db',
  '.env',
  '.env.*',
  '*.lock',
  'package-lock.json',
  'yarn.lock',
  'pnpm-lock.yaml',
  'bun.lockb',
];

// File extensions we care about for code indexing
const CODE_EXTENSIONS = new Set([
  '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs',
  '.py', '.pyw',
  '.go',
  '.rs',
  '.java', '.kt', '.kts',
  '.c', '.cpp', '.cc', '.h', '.hpp',
  '.cs',
  '.rb',
  '.php',
  '.swift',
  '.m', '.mm',
  '.scala',
  '.clj', '.cljs',
  '.ex', '.exs',
  '.hs',
  '.ml', '.mli',
  '.lua',
  '.r', '.R',
  '.jl',
  '.dart',
  '.vue', '.svelte',
  '.sql',
  '.sh', '.bash', '.zsh',
  '.yaml', '.yml',
  '.json',
  '.toml',
  '.xml',
  '.html', '.htm',
  '.css', '.scss', '.sass', '.less',
  '.md', '.mdx',
  '.graphql', '.gql',
  '.proto',
  '.tf', '.tfvars',
]);

export function isCodeFile(path: string): boolean {
  return CODE_EXTENSIONS.has(extname(path).toLowerCase());
}

export function loadGitignore(root: string): ReturnType<typeof ignore> {
  const ig = ignore();

  // Add default ignores
  ig.add(DEFAULT_IGNORES);

  // Load .gitignore if exists
  const gitignorePath = join(root, '.gitignore');
  if (existsSync(gitignorePath)) {
    try {
      const content = readFileSync(gitignorePath, 'utf8');
      ig.add(content);
    } catch {
      // Ignore read errors
    }
  }

  return ig;
}

export function scanDirectory(
  root: string,
  options: {
    maxFiles?: number;
    maxDepth?: number;
    codeOnly?: boolean;
  } = {}
): ScanResult {
  const { maxFiles = 10000, maxDepth = 20, codeOnly = false } = options;

  const ig = loadGitignore(root);
  const files: FileInfo[] = [];
  const directories: string[] = [];
  let totalSize = 0;

  function scan(dir: string, depth: number) {
    if (depth > maxDepth || files.length >= maxFiles) return;

    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      return; // Skip unreadable directories
    }

    for (const entry of entries) {
      if (files.length >= maxFiles) break;

      const absolutePath = join(dir, entry);
      const relativePath = relative(root, absolutePath);

      // Check if ignored
      if (ig.ignores(relativePath)) continue;

      let stats;
      try {
        stats = statSync(absolutePath);
      } catch {
        continue; // Skip unreadable files
      }

      if (stats.isDirectory()) {
        directories.push(relativePath);
        scan(absolutePath, depth + 1);
      } else if (stats.isFile()) {
        // Skip if codeOnly and not a code file
        if (codeOnly && !isCodeFile(entry)) continue;

        // Skip very large files (> 1MB)
        if (stats.size > 1024 * 1024) continue;

        files.push({
          path: relativePath,
          absolutePath,
          name: entry,
          extension: extname(entry).toLowerCase(),
          size: stats.size,
          modifiedAt: stats.mtimeMs,
          type: 'file',
        });
        totalSize += stats.size;
      }
    }
  }

  scan(root, 0);

  // Sort files by path for consistent ordering
  files.sort((a, b) => a.path.localeCompare(b.path));
  directories.sort();

  return {
    root,
    files,
    directories,
    totalFiles: files.length,
    totalSize,
    scannedAt: Date.now(),
  };
}

export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
