import type { Tool, ToolResult, ToolSchema } from '../types.js';
import { ALL_SCHEMAS } from './schemas.js';
import { readTool } from './read.js';
import { editTool } from './edit.js';
import { writeTool } from './write.js';
import { globTool } from './glob.js';
import { grepTool } from './grep.js';
import { bashTool } from './bash.js';
import { lsTool } from './ls.js';
import { multiTool } from './multi.js';
import { scanTool } from './scan.js';
import { peekTool } from './peek.js';
import { sumTool } from './sum.js';
import { indexTool, searchTool, symbolTool } from './search.js';

// =============================================================================
// Tool Registry
// =============================================================================

export const tools: Record<string, Tool> = {
  Read: readTool,
  Edit: editTool,
  Write: writeTool,
  Glob: globTool,
  Grep: grepTool,
  Bash: bashTool,
  LS: lsTool,
  Multi: multiTool,
  Scan: scanTool,
  Peek: peekTool,
  Sum: sumTool,
  Index: indexTool,
  Search: searchTool,
  Symbol: symbolTool,
  // TodoWrite and AskUser are handled specially in the UI
};

export function getToolSchemas(): ToolSchema[] {
  return ALL_SCHEMAS;
}

// Create flexible lookup map with various name formats
const toolLookup: Record<string, Tool> = {};
for (const [name, tool] of Object.entries(tools)) {
  toolLookup[name] = tool;
  toolLookup[name.toLowerCase()] = tool;
  toolLookup[name.toUpperCase()] = tool;
}

// Add common aliases
toolLookup['read_file'] = tools.Read;
toolLookup['ReadFile'] = tools.Read;
toolLookup['write_file'] = tools.Write;
toolLookup['WriteFile'] = tools.Write;
toolLookup['edit_file'] = tools.Edit;
toolLookup['EditFile'] = tools.Edit;
toolLookup['list_directory'] = tools.LS;
toolLookup['ListDirectory'] = tools.LS;
toolLookup['list_files'] = tools.LS;
toolLookup['execute_bash'] = tools.Bash;
toolLookup['run_bash'] = tools.Bash;
toolLookup['shell'] = tools.Bash;
toolLookup['search'] = tools.Grep;
toolLookup['find_files'] = tools.Glob;

// Special tools (handled in useTools but need lookup registration)
// Create placeholder tools for TodoWrite and AskUser
const specialPlaceholder: Tool = {
  name: 'Special',
  description: 'Handled specially in useTools',
  async execute() {
    return { success: true, message: 'Handled in useTools' };
  },
};
toolLookup['TodoWrite'] = specialPlaceholder;
toolLookup['todowrite'] = specialPlaceholder;
toolLookup['TODOWRITE'] = specialPlaceholder;
toolLookup['AskUser'] = specialPlaceholder;
toolLookup['askuser'] = specialPlaceholder;
toolLookup['ASKUSER'] = specialPlaceholder;
toolLookup['AskUserQuestion'] = specialPlaceholder;
toolLookup['askuserquestion'] = specialPlaceholder;

export async function executeToolByName(
  name: string,
  params: Record<string, unknown>
): Promise<ToolResult> {

  // Try exact match first, then lowercase
  const tool = toolLookup[name] || toolLookup[name.toLowerCase()];

  if (!tool) {
    return {
      success: false,
      error: `Unknown tool: ${name}. Available: ${Object.keys(tools).join(', ')}`,
    };
  }

  try {
    return await tool.execute(params);
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Tool execution failed',
    };
  }
}
