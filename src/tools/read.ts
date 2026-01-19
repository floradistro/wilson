import { readFileSync, existsSync, statSync } from 'fs';
import type { Tool, ToolResult } from '../types.js';
import { ReadSchema } from './schemas.js';
import { recordFileRead } from './core/hooks.js';

interface ReadParams {
  file_path: string;
  offset?: number;
  limit?: number;
}

export const readTool: Tool = {
  schema: ReadSchema,

  async execute(params: Record<string, unknown>): Promise<ToolResult> {
    const { file_path, offset = 1, limit = 2000 } = params as unknown as ReadParams;

    if (!file_path) {
      return { success: false, error: 'Missing file_path' };
    }

    if (!existsSync(file_path)) {
      return { success: false, error: `File not found: ${file_path}` };
    }

    // Check if it's a directory
    try {
      const stat = statSync(file_path);
      if (stat.isDirectory()) {
        return { success: false, error: `Path is a directory, not a file. Use LS or Scan instead: ${file_path}` };
      }
    } catch {
      // Continue if stat fails
    }

    try {
      const content = readFileSync(file_path, 'utf8');

      // Record file read for hooks system (read-before-write enforcement)
      recordFileRead(file_path, content);

      const lines = content.split('\n');
      const startLine = Math.max(1, offset);
      const endLine = Math.min(lines.length, startLine - 1 + Math.min(2000, limit));

      const subset = lines.slice(startLine - 1, endLine);
      const numbered = subset.map((line, i) =>
        `${String(startLine + i).padStart(5)}  ${line}`
      ).join('\n');

      return {
        success: true,
        content: numbered,
        totalLines: lines.length,
        cachedForEdit: true,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to read file',
      };
    }
  },
};
