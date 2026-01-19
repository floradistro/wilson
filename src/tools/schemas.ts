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

export const FetchSchema: ToolSchema = {
  name: 'Fetch',
  description: 'Make HTTP requests for API testing and live data debugging. Supports all methods, headers, JSON bodies.',
  parameters: {
    type: 'object',
    properties: {
      url: { type: 'string', description: 'The URL to fetch' },
      method: {
        type: 'string',
        enum: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'],
        description: 'HTTP method (default: GET)',
      },
      headers: {
        type: 'object',
        description: 'Request headers as key-value pairs',
      },
      body: {
        type: ['string', 'object'],
        description: 'Request body (auto-stringified if object)',
      },
      timeout: { type: 'number', description: 'Timeout in ms (default: 30000)' },
      follow_redirects: { type: 'boolean', description: 'Follow redirects (default: true)' },
    },
    required: ['url'],
  },
};

export const SupabaseFetchSchema: ToolSchema = {
  name: 'SupabaseFetch',
  description: 'Query Supabase tables directly. Auto-injects auth headers from config.',
  parameters: {
    type: 'object',
    properties: {
      table: { type: 'string', description: 'Table name to query' },
      select: { type: 'string', description: 'Columns to select (default: *)' },
      filter: { type: 'string', description: 'Filter like "status=eq.active"' },
      limit: { type: 'number', description: 'Max rows (default: 10)' },
      order: { type: 'string', description: 'Order like "created_at.desc"' },
    },
    required: ['table'],
  },
};

export const EnvSchema: ToolSchema = {
  name: 'Env',
  description: 'Wire up a project with Supabase/Wilson credentials. Creates or updates .env files with proper authentication.',
  parameters: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'Path to .env file or project directory (default: cwd)' },
      framework: {
        type: 'string',
        enum: ['nextjs', 'react', 'vue', 'nuxt', 'expo', 'node', 'auto'],
        description: 'Framework to configure (auto-detects if not specified)',
      },
      include_service_key: { type: 'boolean', description: 'Include service role key (server-side only)' },
      dry_run: { type: 'boolean', description: 'Preview changes without writing' },
    },
    required: [],
  },
};

// =============================================================================
// Xcode & iOS Development Schemas
// =============================================================================

export const XcodeBuildSchema: ToolSchema = {
  name: 'XcodeBuild',
  description: 'Build Xcode projects and workspaces. Handles xcodebuild commands with proper configuration.',
  parameters: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'Path to .xcodeproj or .xcworkspace file' },
      scheme: { type: 'string', description: 'Scheme to build (auto-detected if not specified)' },
      configuration: { type: 'string', description: 'Build configuration: Debug or Release (default: Debug)' },
      destination: { type: 'string', description: 'Build destination (e.g., "platform=iOS Simulator,name=iPhone 15")' },
      action: { type: 'string', description: 'Build action: build, test, clean, archive, analyze (default: build)' },
      derived_data_path: { type: 'string', description: 'Custom DerivedData path' },
      quiet: { type: 'boolean', description: 'Reduce output verbosity' },
    },
    required: ['path'],
  },
};

export const SimctlSchema: ToolSchema = {
  name: 'Simctl',
  description: 'Control iOS Simulators - list, boot, shutdown, install apps, take screenshots.',
  parameters: {
    type: 'object',
    properties: {
      action: { type: 'string', description: 'Action: list, boot, shutdown, erase, install, uninstall, launch, screenshot, openurl, status_bar' },
      device: { type: 'string', description: 'Device UDID or name (e.g., "iPhone 15 Pro")' },
      app_path: { type: 'string', description: 'Path to .app bundle (for install action)' },
      bundle_id: { type: 'string', description: 'App bundle ID (for launch/uninstall)' },
      url: { type: 'string', description: 'URL to open (for openurl action)' },
      output_path: { type: 'string', description: 'Output path for screenshot' },
    },
    required: ['action'],
  },
};

export const XcrunSchema: ToolSchema = {
  name: 'Xcrun',
  description: 'Run Xcode developer tools - swift, swiftc, clang, instruments, notarytool, etc.',
  parameters: {
    type: 'object',
    properties: {
      tool: { type: 'string', description: 'Tool to run (swift, swiftc, clang, instruments, notarytool, etc.)' },
      args: { type: 'array', description: 'Arguments to pass to the tool' },
      sdk: { type: 'string', description: 'SDK to use: iphoneos, iphonesimulator, macosx' },
    },
    required: ['tool'],
  },
};

export const SwiftPackageSchema: ToolSchema = {
  name: 'SwiftPackage',
  description: 'Manage Swift packages - build, test, update dependencies.',
  parameters: {
    type: 'object',
    properties: {
      action: { type: 'string', description: 'Action: build, test, clean, update, resolve, show-dependencies, generate-xcodeproj' },
      path: { type: 'string', description: 'Path to package directory (default: cwd)' },
      configuration: { type: 'string', description: 'Build configuration: debug or release' },
      product: { type: 'string', description: 'Specific product to build' },
    },
    required: ['action'],
  },
};

export const XcodeSelectSchema: ToolSchema = {
  name: 'XcodeSelect',
  description: 'Check and manage Xcode installation and developer directory.',
  parameters: {
    type: 'object',
    properties: {
      action: { type: 'string', description: 'Action: print-path, version, switch, install' },
      path: { type: 'string', description: 'Path to Xcode (for switch action)' },
    },
    required: ['action'],
  },
};

// =============================================================================
// Project Management Schemas
// =============================================================================

export const NpmSchema: ToolSchema = {
  name: 'Npm',
  description: 'Run npm commands - install, build, test, run scripts.',
  parameters: {
    type: 'object',
    properties: {
      action: { type: 'string', description: 'Action: install, build, test, run, audit, outdated, update' },
      script: { type: 'string', description: 'Script name (for run action)' },
      packages: { type: 'array', description: 'Packages to install' },
      path: { type: 'string', description: 'Project directory (default: cwd)' },
      dev: { type: 'boolean', description: 'Install as dev dependency' },
    },
    required: ['action'],
  },
};

export const GitSchema: ToolSchema = {
  name: 'Git',
  description: 'Git operations - status, diff, log, branch, checkout, commit, push, pull.',
  parameters: {
    type: 'object',
    properties: {
      action: { type: 'string', description: 'Action: status, diff, log, branch, checkout, add, commit, push, pull, stash, fetch' },
      path: { type: 'string', description: 'Repository directory (default: cwd)' },
      branch: { type: 'string', description: 'Branch name (for checkout/branch actions)' },
      message: { type: 'string', description: 'Commit message (for commit action)' },
      files: { type: 'array', description: 'Files to add/commit' },
      count: { type: 'number', description: 'Number of commits for log (default: 10)' },
    },
    required: ['action'],
  },
};

export const BunSchema: ToolSchema = {
  name: 'Bun',
  description: 'Run bun commands - install, build, test, run scripts.',
  parameters: {
    type: 'object',
    properties: {
      action: { type: 'string', description: 'Action: install, build, test, run, add, remove, update' },
      script: { type: 'string', description: 'Script name (for run action)' },
      packages: { type: 'array', description: 'Packages to add/remove' },
      path: { type: 'string', description: 'Project directory (default: cwd)' },
      dev: { type: 'boolean', description: 'Install as dev dependency' },
    },
    required: ['action'],
  },
};

// DevServer tool REMOVED - use Bash tool instead
// The Bash tool auto-detects dev servers and runs them in background
// Example: Bash { command: "npm run dev" } - auto-runs in background
// To kill a port: Bash { command: "lsof -ti:3000 | xargs kill -9" }

export const DebugSchema: ToolSchema = {
  name: 'Debug',
  description: `Self-feedback loop for error detection and debugging.

ACTIONS:
- analyze: Parse error output, extract errors, suggest fixes
- run-check: Run a command and analyze its output for errors
- read-log: Read and parse log files for errors/warnings
- find-logs: Find log files in a project
- stack-trace: Parse a stack trace to identify error location
- health: Check project health (deps, config, common issues)

SELF-CORRECTION PATTERN:
1. Run command (build/test) with run-check
2. If errors, analyze output
3. Get suggestions for fixes
4. Apply fixes
5. Re-run to verify

ERROR TYPES DETECTED:
- TypeScript errors (TS2345, etc.)
- ESLint errors and warnings
- Import/module not found errors
- Syntax errors
- Build failures
- Test failures
- Permission errors
- Network errors`,
  parameters: {
    type: 'object',
    properties: {
      action: { type: 'string', description: 'Action: analyze, run-check, read-log, find-logs, stack-trace, health' },
      output: { type: 'string', description: 'Error output to analyze (for analyze, stack-trace)' },
      path: { type: 'string', description: 'File or project path' },
      command: { type: 'string', description: 'Command to run (for run-check)' },
      lines: { type: 'number', description: 'Number of log lines to read (default: 100)' },
      level: { type: 'string', description: 'Filter logs by level: error, warn, info, debug' },
    },
    required: ['action'],
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
  FetchSchema,
  SupabaseFetchSchema,
  EnvSchema,
  TodoWriteSchema,
  AskUserSchema,
  // Xcode tools
  XcodeBuildSchema,
  SimctlSchema,
  XcrunSchema,
  SwiftPackageSchema,
  XcodeSelectSchema,
  // Project management tools
  NpmSchema,
  GitSchema,
  BunSchema,
  // DevServer REMOVED - use Bash instead (auto-detects servers)
  // Debug & feedback
  DebugSchema,
];
