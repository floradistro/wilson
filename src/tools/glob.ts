import { execSync } from 'child_process';
import type { Tool, ToolResult } from '../types.js';
import { GlobSchema } from './schemas.js';

interface GlobParams {
  pattern: string;
  path?: string;
  limit?: number;
}

export const globTool: Tool = {
  schema: GlobSchema,

  async execute(params: Record<string, unknown>): Promise<ToolResult> {
    const { pattern, path = process.cwd(), limit = 100 } = params as unknown as GlobParams;

    if (!pattern) {
      return { success: false, error: 'Missing pattern' };
    }

    try {
      // Sanitize inputs
      const safePath = path.replace(/[`$();&|<>]/g, '');
      const safeLimit = Math.min(limit, 1000);

      // Build find command based on pattern
      let findCmd: string;

      if (pattern.includes('**')) {
        // Recursive glob
        const filename = pattern.replace(/\*\*\//g, '').replace(/[`$();&|<>]/g, '');
        findCmd = `find "${safePath}" -type f -name "${filename}" 2>/dev/null | head -${safeLimit}`;
      } else if (pattern.includes('/')) {
        // Path-based pattern
        const parts = pattern.split('/');
        const filename = (parts.pop() || '*').replace(/[`$();&|<>]/g, '');
        const subdir = parts.join('/').replace(/[`$();&|<>]/g, '');
        const searchPath = subdir ? `${safePath}/${subdir}` : safePath;
        findCmd = `find "${searchPath}" -type f -name "${filename}" 2>/dev/null | head -${safeLimit}`;
      } else {
        // Simple filename pattern
        const filename = pattern.replace(/[`$();&|<>]/g, '');
        findCmd = `find "${safePath}" -type f -name "${filename}" 2>/dev/null | head -${safeLimit}`;
      }

      const output = execSync(findCmd, {
        encoding: 'utf8',
        timeout: 30000,
        maxBuffer: 10 * 1024 * 1024,
      });

      const files = output.trim().split('\n').filter(Boolean);

      return {
        success: true,
        files,
        count: files.length,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Glob search failed',
      };
    }
  },
};
