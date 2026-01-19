import { readdirSync, statSync } from 'fs';
import { join } from 'path';
import type { Tool, ToolResult } from '../types.js';
import { LSSchema } from './schemas.js';

interface LSParams {
  path: string;
  all?: boolean;
  long?: boolean;
}

export const lsTool: Tool = {
  schema: LSSchema,

  async execute(params: Record<string, unknown>): Promise<ToolResult> {
    const { path, all = false, long = false } = params as unknown as LSParams;

    if (!path) {
      return { success: false, error: 'Missing path' };
    }

    try {
      const entries = readdirSync(path);

      const filtered = all
        ? entries
        : entries.filter((e) => !e.startsWith('.'));

      if (!long) {
        return {
          success: true,
          files: filtered,
          count: filtered.length,
          path,
        };
      }

      // Long format with details
      const detailed = filtered.map((entry) => {
        try {
          const fullPath = join(path, entry);
          const stat = statSync(fullPath);
          const type = stat.isDirectory() ? 'd' : '-';
          const size = formatSize(stat.size);
          const date = formatDate(stat.mtime);
          return `${type} ${size.padStart(8)} ${date} ${entry}`;
        } catch {
          return `? ${entry}`;
        }
      });

      return {
        success: true,
        files: detailed,
        count: detailed.length,
        path,
        long: true,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to list directory',
      };
    }
  },
};

function formatSize(bytes: number): string {
  if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(1)}G`;
  if (bytes >= 1e6) return `${(bytes / 1e6).toFixed(1)}M`;
  if (bytes >= 1e3) return `${(bytes / 1e3).toFixed(1)}K`;
  return `${bytes}B`;
}

function formatDate(date: Date): string {
  const month = date.toLocaleString('en', { month: 'short' });
  const day = date.getDate().toString().padStart(2, ' ');
  const time = date.toLocaleTimeString('en', { hour: '2-digit', minute: '2-digit', hour12: false });
  return `${month} ${day} ${time}`;
}
