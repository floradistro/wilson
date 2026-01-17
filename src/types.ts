// =============================================================================
// Core Types
// =============================================================================

export interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  toolCalls?: ToolCall[];
  timestamp: Date;
}

export interface ToolCall {
  id: string;
  name: string;
  input: Record<string, unknown>;
  status: 'pending' | 'running' | 'completed' | 'error';
  result?: ToolResult;
}

export interface ToolResult {
  success: boolean;
  content?: string;
  error?: string;
  // Allow arbitrary additional properties for tool-specific results
  [key: string]: unknown;
}

export interface Flags {
  dangerouslySkipPermissions?: boolean;
  verbose?: boolean;
  help?: boolean;
  version?: boolean;
}

// =============================================================================
// Auth Types
// =============================================================================

export interface AuthState {
  accessToken: string | null;
  refreshToken: string | null;
  expiresAt: number | null;
  user: User | null;
  storeId: string | null;
  storeName: string | null;
  role: string | null;
}

export interface User {
  id: string;
  email: string;
}

export interface StoreInfo {
  storeId: string;
  storeName: string;
  role: string;
}

// =============================================================================
// API Types
// =============================================================================

export interface StreamEvent {
  type: 'text_delta' | 'tool_start' | 'tool_result' | 'pause_for_tools' | 'usage' | 'error' | 'done';
  content?: string;
  tool?: {
    id: string;
    name: string;
    input: Record<string, unknown>;
  };
  pending_tools?: Array<{
    id: string;
    name: string;
    input: Record<string, unknown>;
  }>;
  assistant_content?: string;
  error?: string;
  usage?: {
    input_tokens: number;
    output_tokens: number;
  };
}

export interface ChatRequest {
  message: string;
  history: Array<{ role: string; content: string }>;
  store_id?: string;
  working_directory: string;
  platform: string;
  client: 'cli';
  local_tools: ToolSchema[];
  tool_results?: Array<{ tool_use_id: string; content: string }>;
  pending_assistant_content?: string;
}

// =============================================================================
// Tool Types
// =============================================================================

export interface ToolSchema {
  name: string;
  description: string;
  parameters: {
    type: 'object';
    properties: Record<string, ToolParameter>;
    required: string[];
  };
}

export interface ToolParameter {
  type: 'string' | 'number' | 'boolean' | 'array' | 'object';
  description: string;
  enum?: string[];
  items?: ToolParameter;
  properties?: Record<string, ToolParameter>;
}

export interface Tool {
  name?: string;
  description?: string;
  schema?: ToolSchema;
  execute: (params: Record<string, unknown>) => Promise<ToolResult>;
}

// =============================================================================
// UI State Types
// =============================================================================

export interface Todo {
  content: string;
  status: 'pending' | 'in_progress' | 'completed';
}

export interface UsageStats {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  cost?: number;
}

export interface PendingQuestion {
  toolId: string;
  question: string;
  options?: string[];
}

export interface PendingPermission {
  toolId: string;
  operation: string;
  command: string;
}

export interface ChartData {
  type: 'bar' | 'line';
  title: string;
  data: Array<{ label: string; value: number }>;
  isCurrency?: boolean;
}
