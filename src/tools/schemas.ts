import type { ToolSchema } from '../types.js';

// =============================================================================
// Tool Schemas - Ported from lisa.js
// =============================================================================

export const ReadSchema: ToolSchema = {
  name: 'Read',
  description: 'Read a file from the filesystem. Returns content with line numbers.',
  parameters: {
    type: 'object',
    properties: {
      file_path: { type: 'string', description: 'Absolute path to the file to read' },
      offset: { type: 'number', description: 'Line number to start reading from (1-indexed)' },
      limit: { type: 'number', description: 'Number of lines to read (default: 2000)' },
    },
    required: ['file_path'],
  },
};

export const EditSchema: ToolSchema = {
  name: 'Edit',
  description: 'Edit a file by replacing exact text. The old_string must be unique in the file unless using replace_all.',
  parameters: {
    type: 'object',
    properties: {
      file_path: { type: 'string', description: 'Absolute path to the file to modify' },
      old_string: { type: 'string', description: 'The exact text to find and replace' },
      new_string: { type: 'string', description: 'The replacement text' },
      replace_all: { type: 'boolean', description: 'If true, replace ALL occurrences (default: false)' },
    },
    required: ['file_path', 'old_string', 'new_string'],
  },
};

export const WriteSchema: ToolSchema = {
  name: 'Write',
  description: 'Write content to a file. Creates parent directories if needed. Overwrites existing files.',
  parameters: {
    type: 'object',
    properties: {
      file_path: { type: 'string', description: 'Absolute path to the file to write' },
      content: { type: 'string', description: 'Content to write to the file' },
    },
    required: ['file_path', 'content'],
  },
};

export const GlobSchema: ToolSchema = {
  name: 'Glob',
  description: 'Find files matching a glob pattern. Supports ** for recursive matching.',
  parameters: {
    type: 'object',
    properties: {
      pattern: { type: 'string', description: "Glob pattern like '**/*.js' or 'src/**/*.ts'" },
      path: { type: 'string', description: 'Base directory to search in (default: cwd)' },
      limit: { type: 'number', description: 'Maximum results (default: 100)' },
    },
    required: ['pattern'],
  },
};

export const GrepSchema: ToolSchema = {
  name: 'Grep',
  description: 'Search for regex patterns in files. Supports context lines and multiple output modes.',
  parameters: {
    type: 'object',
    properties: {
      pattern: { type: 'string', description: 'Regex pattern to search for' },
      path: { type: 'string', description: 'File or directory to search (default: cwd)' },
      glob: { type: 'string', description: "Filter files by glob, e.g. '*.js' or '*.{ts,tsx}'" },
      include: { type: 'string', description: 'File type filter: js, ts, py, go, rust, etc.' },
      case_insensitive: { type: 'boolean', description: 'Case insensitive search' },
      context_before: { type: 'number', description: 'Lines before match (-B)' },
      context_after: { type: 'number', description: 'Lines after match (-A)' },
      context: { type: 'number', description: 'Lines before AND after (-C)' },
      output_mode: {
        type: 'string',
        enum: ['content', 'files', 'count'],
        description: "'content'=lines, 'files'=paths only, 'count'=counts",
      },
      limit: { type: 'number', description: 'Max results (default: 50)' },
    },
    required: ['pattern'],
  },
};

export const BashSchema: ToolSchema = {
  name: 'Bash',
  description: 'Execute a shell command. Long-running commands (servers, watchers) auto-run in background.',
  parameters: {
    type: 'object',
    properties: {
      command: { type: 'string', description: 'The bash command to execute' },
      cwd: { type: 'string', description: 'Working directory (default: cwd)' },
      timeout: { type: 'number', description: 'Timeout in ms (default: 120000, max: 600000)' },
      description: { type: 'string', description: 'Short description of what this command does' },
      background: { type: 'boolean', description: 'Run in background and return immediately (auto for servers)' },
    },
    required: ['command'],
  },
};

export const LSSchema: ToolSchema = {
  name: 'LS',
  description: 'List directory contents with file types and sizes.',
  parameters: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'Directory path to list' },
      all: { type: 'boolean', description: 'Include hidden files' },
      long: { type: 'boolean', description: 'Long format with sizes/dates' },
    },
    required: ['path'],
  },
};

export const MultiSchema: ToolSchema = {
  name: 'Multi',
  description: 'Read multiple files in parallel. More efficient than sequential Reads.',
  parameters: {
    type: 'object',
    properties: {
      paths: {
        type: 'array',
        items: { type: 'string', description: 'File path' },
        description: 'File paths to read',
      },
      lines: { type: 'number', description: 'Max lines per file (default: 500)' },
    },
    required: ['paths'],
  },
};

export const ScanSchema: ToolSchema = {
  name: 'Scan',
  description: 'Analyze directory structure recursively. Returns tree with file counts and sizes.',
  parameters: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'Directory to analyze' },
      depth: { type: 'number', description: 'Max depth (default: 5)' },
      content: { type: 'boolean', description: 'Include file previews' },
      pattern: { type: 'string', description: 'Glob filter for files' },
    },
    required: ['path'],
  },
};

export const PeekSchema: ToolSchema = {
  name: 'Peek',
  description: 'Sample large JSON/JSONL files. Returns schema, samples, and optional aggregations.',
  parameters: {
    type: 'object',
    properties: {
      file_path: { type: 'string', description: 'Path to JSON or JSONL file' },
      limit: { type: 'number', description: 'Records to sample (default: 100)' },
      aggregate: {
        type: 'object',
        description: 'Aggregation options',
        properties: {
          groupBy: { type: 'string', description: 'Field to group by' },
          sumFields: {
            type: 'array',
            items: { type: 'string', description: 'Field name to sum' },
            description: 'Fields to sum',
          },
        },
      },
    },
    required: ['file_path'],
  },
};

export const SumSchema: ToolSchema = {
  name: 'Sum',
  description: 'Aggregate JSON files in a directory. Smart handling of COVA exports to avoid double-counting.',
  parameters: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'Directory or file path' },
      group: { type: 'string', description: "Group by field (default: 'Product')" },
      fields: {
        type: 'array',
        items: { type: 'string', description: 'Field name to sum' },
        description: 'Fields to sum',
      },
      top: { type: 'number', description: 'Top N results (default: 20)' },
      type: {
        type: 'string',
        enum: ['product', 'invoice', 'itemized', 'daily', 'auto'],
        description: "Report type or 'auto' to detect",
      },
    },
    required: ['path'],
  },
};

export const TodoWriteSchema: ToolSchema = {
  name: 'TodoWrite',
  description: 'Create and manage a task list for complex multi-step tasks.',
  parameters: {
    type: 'object',
    properties: {
      todos: {
        type: 'array',
        description: 'Array of todo items',
        items: {
          type: 'object',
          description: 'A todo item with content and status',
          properties: {
            content: { type: 'string', description: 'Task description (imperative form)' },
            status: {
              type: 'string',
              enum: ['pending', 'in_progress', 'completed'],
              description: 'Task status',
            },
          },
        },
      },
    },
    required: ['todos'],
  },
};

export const AskUserSchema: ToolSchema = {
  name: 'AskUser',
  description: 'Ask the user a question when you need clarification.',
  parameters: {
    type: 'object',
    properties: {
      question: { type: 'string', description: 'The question to ask' },
      options: {
        type: 'array',
        description: 'Optional list of choices',
        items: { type: 'string', description: 'A choice option' },
      },
    },
    required: ['question'],
  },
};

export const IndexSchema: ToolSchema = {
  name: 'Index',
  description: 'Build or update the codebase index for faster search. Run once at the start of a project.',
  parameters: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'Project root directory (default: cwd)' },
      force: { type: 'boolean', description: 'Force full rebuild (default: false)' },
    },
    required: [],
  },
};

export const SearchSchema: ToolSchema = {
  name: 'Search',
  description: 'Search the indexed codebase. Finds files, symbols, and semantic matches.',
  parameters: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'Search query' },
      type: {
        type: 'string',
        enum: ['all', 'file', 'symbol', 'semantic'],
        description: "Search type: 'all', 'file', 'symbol', or 'semantic' (default: 'all')",
      },
      kind: {
        type: 'string',
        enum: ['function', 'class', 'interface', 'type', 'method', 'variable'],
        description: 'Filter symbols by kind (only for symbol search)',
      },
      limit: { type: 'number', description: 'Max results (default: 20)' },
    },
    required: ['query'],
  },
};

export const SymbolSchema: ToolSchema = {
  name: 'Symbol',
  description: 'Look up a specific symbol (function, class, etc.) by exact name.',
  parameters: {
    type: 'object',
    properties: {
      name: { type: 'string', description: 'Symbol name to look up' },
    },
    required: ['name'],
  },
};

// All schemas for export
export const ALL_SCHEMAS: ToolSchema[] = [
  ReadSchema,
  EditSchema,
  WriteSchema,
  GlobSchema,
  GrepSchema,
  BashSchema,
  LSSchema,
  IndexSchema,
  SearchSchema,
  SymbolSchema,
  TodoWriteSchema,
  AskUserSchema,
];
