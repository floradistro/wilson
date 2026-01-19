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
    const editParams: SmartEditParams = {
      file_path: params.file_path as string,
      old_string: params.old_string as string,
      new_string: params.new_string as string,
      replace_all: params.replace_all as boolean | undefined,
      // Enable smart features by default
      fuzzy: true,
      auto_expand: true,
    };

    return smartEdit(editParams);
  },
};
