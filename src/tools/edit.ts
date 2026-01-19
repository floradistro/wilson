/**
 * Enhanced Edit Tool
 *
 * Anthropic-style improvements:
 * - Smart fuzzy matching with suggestions
 * - Read-before-write enforcement
 * - Detailed error messages with fix suggestions
 * - Auto-correction hints
 */

import type { Tool, ToolResult } from '../types.js';
import { EditSchema } from './schemas.js';
import { smartEdit, type SmartEditParams } from './core/smart-edit.js';

export const editTool: Tool = {
  schema: EditSchema,

  async execute(params: Record<string, unknown>): Promise<ToolResult> {
    // Validate parameters are strings
    const filePath = params.file_path;
    const oldString = params.old_string;
    const newString = params.new_string;

    if (typeof filePath !== 'string' || !filePath) {
      return { success: false, error: 'file_path must be a non-empty string' };
    }
    if (typeof oldString !== 'string') {
      return { success: false, error: `old_string must be a string, got ${typeof oldString}` };
    }
    if (typeof newString !== 'string') {
      return { success: false, error: `new_string must be a string, got ${typeof newString}` };
    }

    const editParams: SmartEditParams = {
      file_path: filePath,
      old_string: oldString,
      new_string: newString,
      replace_all: params.replace_all as boolean | undefined,
      // Enable smart features by default
      fuzzy: true,
      auto_expand: true,
    };

    return smartEdit(editParams);
  },
};
