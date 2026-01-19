import { writeFileSync, readFileSync, mkdirSync, existsSync } from 'fs';
import { dirname } from 'path';
import type { Tool, ToolResult } from '../types.js';
import { WriteSchema } from './schemas.js';

interface DiffLine {
  type: 'context' | 'add' | 'remove';
  content: string;
  lineNum?: number;
}

interface WriteParams {
  file_path: string;
  content: string;
}

export const writeTool: Tool = {
  schema: WriteSchema,

  async execute(params: Record<string, unknown>): Promise<ToolResult> {
    const { file_path, content } = params as unknown as WriteParams;

    if (!file_path) {
      return { success: false, error: 'Missing file_path' };
    }

    if (content === undefined) {
      return { success: false, error: 'Missing content' };
    }

    try {
      // Create parent directories if needed
      const dir = dirname(file_path);
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
      }

      // Check if file exists to generate diff
      const isNew = !existsSync(file_path);
      const oldContent = isNew ? '' : readFileSync(file_path, 'utf8');

      writeFileSync(file_path, content);

      // Generate diff
      const newLines = content.split('\n');
      const oldLines = oldContent.split('\n');
      const diff: DiffLine[] = [];

      if (isNew) {
        // New file - all lines are additions with line numbers
        newLines.slice(0, 15).forEach((line, i) => {
          diff.push({ type: 'add', content: line, lineNum: i + 1 });
        });
        if (newLines.length > 15) {
          diff.push({ type: 'context', content: `… ${newLines.length - 15} more lines` });
        }
      } else {
        // Show removed lines (first few)
        oldLines.slice(0, 5).forEach((line, i) => {
          diff.push({ type: 'remove', content: line, lineNum: i + 1 });
        });
        if (oldLines.length > 5) {
          diff.push({ type: 'context', content: `... ${oldLines.length - 5} more removed` });
        }
        // Show added lines (first few) with line numbers
        newLines.slice(0, 10).forEach((line, i) => {
          diff.push({ type: 'add', content: line, lineNum: i + 1 });
        });
        if (newLines.length > 10) {
          diff.push({ type: 'context', content: `… ${newLines.length - 10} more` });
        }
      }

      const summary = isNew
        ? `${file_path.split('/').pop()}: +${newLines.length} lines (new file)`
        : `${file_path.split('/').pop()}: -${oldLines.length} +${newLines.length} lines`;

      return {
        success: true,
        file: file_path,
        diff,
        summary,
        isNew,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to write file',
      };
    }
  },
};
