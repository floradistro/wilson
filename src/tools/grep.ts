import { execSync } from 'child_process';
import type { Tool, ToolResult } from '../types.js';
import { GrepSchema } from './schemas.js';

interface GrepParams {
  pattern: string;
  path?: string;
  glob?: string;
  include?: string;
  case_insensitive?: boolean;
  context_before?: number;
  context_after?: number;
  context?: number;
  output_mode?: 'content' | 'files' | 'count';
  limit?: number;
}

export const grepTool: Tool = {
  schema: GrepSchema,

  async execute(params: Record<string, unknown>): Promise<ToolResult> {
    const {
      pattern,
      path = '.',
      glob,
      include,
      case_insensitive = false,
      context_before,
      context_after,
      context,
      output_mode = 'content',
      limit = 50,
    } = params as unknown as GrepParams;

    if (!pattern) {
      return { success: false, error: 'Missing pattern' };
    }

    try {
      const safePath = path.replace(/[`$();&|<>]/g, '');
      const safeLimit = Math.min(limit, 500);

      // Check if ripgrep is available
      let useRg = false;
      try {
        execSync('which rg', { encoding: 'utf8' });
        useRg = true;
      } catch {
        // Fall back to grep
      }

      // Build command
      const args: string[] = [];

      if (useRg) {
        args.push('rg');

        if (output_mode === 'files') {
          args.push('-l');
        } else if (output_mode === 'count') {
          args.push('-c');
        } else {
          args.push('-n'); // Line numbers
        }

        if (case_insensitive) args.push('-i');
        if (context) args.push(`-C${context}`);
        if (context_before) args.push(`-B${context_before}`);
        if (context_after) args.push(`-A${context_after}`);
        if (glob) args.push(`--glob="${glob}"`);
        if (include) args.push(`--type=${include}`);

        args.push(`"${pattern.replace(/"/g, '\\"')}"`);
        args.push(`"${safePath}"`);
      } else {
        args.push('grep');
        args.push('-rn');

        if (case_insensitive) args.push('-i');
        if (output_mode === 'files') args.push('-l');
        if (output_mode === 'count') args.push('-c');
        if (context) args.push(`-C${context}`);
        if (context_before) args.push(`-B${context_before}`);
        if (context_after) args.push(`-A${context_after}`);
        if (glob) args.push(`--include="${glob}"`);

        args.push(`"${pattern.replace(/"/g, '\\"')}"`);
        args.push(`"${safePath}"`);
      }

      const cmd = `${args.join(' ')} 2>/dev/null | head -${safeLimit}`;

      const output = execSync(cmd, {
        encoding: 'utf8',
        timeout: 30000,
        maxBuffer: 10 * 1024 * 1024,
      });

      return {
        success: true,
        content: output.trim() || 'No matches found',
      };
    } catch (error) {
      // grep returns exit code 1 when no matches
      if (error instanceof Error && 'status' in error && (error as NodeJS.ErrnoException & { status?: number }).status === 1) {
        return { success: true, content: 'No matches found' };
      }

      return {
        success: false,
        error: error instanceof Error ? error.message : 'Grep search failed',
      };
    }
  },
};
