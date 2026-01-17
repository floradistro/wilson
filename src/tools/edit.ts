import { readFileSync, writeFileSync, existsSync } from 'fs';
import type { Tool, ToolResult } from '../types.js';
import { EditSchema } from './schemas.js';

interface EditParams {
  file_path: string;
  old_string: string;
  new_string: string;
  replace_all?: boolean;
}

interface DiffLine {
  type: 'context' | 'add' | 'remove';
  content: string;
  lineNum?: number;
}

/**
 * Generate a unified diff-style output for the edit
 */
function generateDiff(
  oldContent: string,
  newContent: string,
  oldString: string,
  newString: string,
  filePath: string
): { diff: DiffLine[]; summary: string } {
  const oldLines = oldString.split('\n');
  const newLines = newString.split('\n');

  // Find where the change starts in the file
  const contentLines = oldContent.split('\n');
  const changeStart = contentLines.findIndex(line =>
    oldString.startsWith(line) || oldString.includes(line)
  );

  const diff: DiffLine[] = [];

  // Add context before (2 lines)
  if (changeStart > 0) {
    const contextStart = Math.max(0, changeStart - 2);
    for (let i = contextStart; i < changeStart; i++) {
      diff.push({ type: 'context', content: contentLines[i], lineNum: i + 1 });
    }
  }

  // Add removed lines
  oldLines.forEach((line, i) => {
    diff.push({ type: 'remove', content: line, lineNum: changeStart + i + 1 });
  });

  // Add added lines
  newLines.forEach((line) => {
    diff.push({ type: 'add', content: line });
  });

  // Add context after (2 lines)
  const afterStart = changeStart + oldLines.length;
  for (let i = afterStart; i < Math.min(afterStart + 2, contentLines.length); i++) {
    diff.push({ type: 'context', content: contentLines[i], lineNum: i + 1 });
  }

  const removed = oldLines.length;
  const added = newLines.length;
  const summary = `${filePath.split('/').pop()}: -${removed} +${added} lines`;

  return { diff, summary };
}

export const editTool: Tool = {
  schema: EditSchema,

  async execute(params: Record<string, unknown>): Promise<ToolResult> {
    const { file_path, old_string, new_string, replace_all = false } = params as unknown as EditParams;

    if (!file_path) {
      return { success: false, error: 'Missing file_path' };
    }

    if (!old_string) {
      return { success: false, error: 'Missing old_string' };
    }

    if (!existsSync(file_path)) {
      return { success: false, error: `File not found: ${file_path}` };
    }

    try {
      const content = readFileSync(file_path, 'utf8');

      if (!content.includes(old_string)) {
        // Show a preview of the file content to help Claude find the right string
        const lines = content.split('\n');
        const preview = lines.slice(0, 30).map((line, i) =>
          `${String(i + 1).padStart(3)}| ${line}`
        ).join('\n');
        const truncated = lines.length > 30 ? `\n... (${lines.length - 30} more lines)` : '';

        return {
          success: false,
          error: `String not found in file. The old_string must match EXACTLY including whitespace.\n\nFile preview:\n${preview}${truncated}`
        };
      }

      // Check uniqueness if not replace_all
      if (!replace_all) {
        const count = content.split(old_string).length - 1;
        if (count > 1) {
          return {
            success: false,
            error: `String found ${count} times. Use replace_all=true or provide more context.`,
          };
        }
      }

      const newContent = replace_all
        ? content.split(old_string).join(new_string)
        : content.replace(old_string, new_string);

      writeFileSync(file_path, newContent);

      // Generate diff for visual display
      const { diff, summary } = generateDiff(content, newContent, old_string, new_string, file_path);

      return {
        success: true,
        file: file_path,
        diff,
        summary,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to edit file',
      };
    }
  },
};
