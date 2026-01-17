import { readdir, stat } from 'fs/promises';
import { join, basename, extname } from 'path';
import type { Tool, ToolResult } from '../types.js';

interface ScanParams {
  path: string;
  depth?: number;
  content?: boolean;
  pattern?: string;
}

interface FileInfo {
  name: string;
  path: string;
  size: number;
  ext: string;
}

const PARALLEL_BATCH = 10;

function formatBytes(bytes: number): string {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  if (bytes < 1024 * 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  return (bytes / (1024 * 1024 * 1024)).toFixed(2) + ' GB';
}

async function parallelStatFiles(paths: string[]) {
  return Promise.all(
    paths.map(async (p) => {
      try {
        const s = await stat(p);
        return { path: p, size: s.size, isDir: s.isDirectory(), mtime: s.mtime, error: null };
      } catch (err) {
        return { path: p, size: 0, isDir: false, mtime: null, error: err instanceof Error ? err.message : 'stat failed' };
      }
    })
  );
}

export const scanTool: Tool = {
  name: 'Scan',
  description: 'Analyze directory structure recursively. Returns tree with file counts and sizes.',

  async execute(params: Record<string, unknown>): Promise<ToolResult> {
    const { path: dirPath, depth: maxDepth = 5 } = params as unknown as ScanParams;

    if (!dirPath) {
      return { success: false, error: 'Missing path' };
    }

    const results = {
      path: dirPath,
      totalSize: 0,
      totalSizeFormatted: '',
      fileCount: 0,
      dirCount: 0,
      files: [] as FileInfo[],
      byExtension: {} as Record<string, { count: number; size: number }>,
      bySize: { small: 0, medium: 0, large: 0, huge: 0 },
      largestFiles: [] as { path: string; size: number; name: string }[],
      errors: [] as { path: string; error: string }[],
    };

    async function walkDir(currentPath: string, depth: number) {
      if (depth > maxDepth) return;

      try {
        const entries = await readdir(currentPath, { withFileTypes: true });
        const files: string[] = [];
        const dirs: string[] = [];

        for (const entry of entries) {
          if (entry.name.startsWith('.')) continue;
          const fullPath = join(currentPath, entry.name);

          if (entry.isDirectory()) {
            dirs.push(fullPath);
            results.dirCount++;
          } else if (entry.isFile()) {
            files.push(fullPath);
          }
        }

        // Process files in parallel batches
        for (let i = 0; i < files.length; i += PARALLEL_BATCH) {
          const batch = files.slice(i, i + PARALLEL_BATCH);
          const stats = await parallelStatFiles(batch);

          for (const s of stats) {
            if (s.error) {
              results.errors.push({ path: s.path, error: s.error });
              continue;
            }

            results.fileCount++;
            results.totalSize += s.size;

            const ext = extname(s.path).toLowerCase() || '(no ext)';
            if (!results.byExtension[ext]) {
              results.byExtension[ext] = { count: 0, size: 0 };
            }
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

        // Recurse into subdirectories
        for (const dir of dirs) {
          await walkDir(dir, depth + 1);
        }
      } catch (err) {
        results.errors.push({
          path: currentPath,
          error: err instanceof Error ? err.message : 'walk failed',
        });
      }
    }

    try {
      await walkDir(dirPath, 0);

      // Sort largest files and keep top 10
      results.largestFiles.sort((a, b) => b.size - a.size);
      results.largestFiles = results.largestFiles.slice(0, 10).map((f) => ({
        ...f,
        sizeFormatted: formatBytes(f.size),
      })) as typeof results.largestFiles;

      results.totalSizeFormatted = formatBytes(results.totalSize);

      return { success: true, ...results };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : 'Scan failed' };
    }
  },
};
