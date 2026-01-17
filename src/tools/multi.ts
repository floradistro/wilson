import { readFile } from 'fs/promises';
import type { Tool, ToolResult } from '../types.js';

interface MultiParams {
  paths: string[];
  lines?: number;
}

export const multiTool: Tool = {
  name: 'Multi',
  description: 'Read multiple files in parallel. More efficient than sequential Reads.',

  async execute(params: Record<string, unknown>): Promise<ToolResult> {
    const { paths, lines = 500 } = params as unknown as MultiParams;

    if (!paths || !Array.isArray(paths)) {
      return { success: false, error: 'Missing paths array' };
    }

    const results = await Promise.all(
      paths.map(async (filePath) => {
        try {
          const content = await readFile(filePath, 'utf8');
          const fileLines = content.split('\n');
          const subset = fileLines.slice(0, lines);
          return {
            path: filePath,
            success: true,
            content: subset.map((l, i) => `${String(i + 1).padStart(5)}  ${l}`).join('\n'),
            totalLines: fileLines.length,
            truncated: fileLines.length > lines,
          };
        } catch (err) {
          return {
            path: filePath,
            success: false,
            error: err instanceof Error ? err.message : 'Read failed',
          };
        }
      })
    );

    return { success: true, files: results };
  },
};
