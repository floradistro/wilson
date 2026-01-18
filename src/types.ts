// =============================================================================
// Core Types
// =============================================================================

export interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  toolCalls?: ToolCall[];
  // Structured data from tool results - for rendering charts/tables
  toolData?: ToolData[];
  timestamp: Date;
  isStreaming?: boolean;
}

// Structured data from backend tool execution
export interface ToolData {
  toolName: string;
  toolId: string;
  data: unknown; // The parsed JSON result
  elapsed_ms?: number;
  isError?: boolean;
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

export interface LocationInfo {
  id: string;
  name: string;
  isDefault: boolean;
}

export interface StoreContext {
  store: StoreInfo;
  location: LocationInfo | null;
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

// =============================================================================
// Chart Types - Terminal Visualization
// =============================================================================

/** Data point for bar, line, and donut charts */
export interface ChartDataPoint {
  label: string;
  value: number;
}

/** Metric item for KPI displays */
export interface MetricDataPoint {
  label: string;
  value: string;
  change?: number; // Percentage change, e.g., 12.3 or -5.2
}

/** Bar chart data structure */
export interface BarChartData {
  type: 'bar';
  title: string;
  data: ChartDataPoint[];
  isCurrency?: boolean;
}

/** Line chart / sparkline data structure */
export interface LineChartData {
  type: 'line';
  title: string;
  data: ChartDataPoint[];
}

/** Donut/pie chart data structure */
export interface DonutChartData {
  type: 'donut' | 'pie';
  title: string;
  data: ChartDataPoint[];
  isCurrency?: boolean;
}

/** Metrics/KPI card data structure */
export interface MetricsChartData {
  type: 'metrics';
  title: string;
  data: MetricDataPoint[];
}

/** Table data structure */
export interface TableChartData {
  type: 'table';
  title: string;
  headers: string[];
  rows: (string | number)[][];
}

/** Union type for all chart configurations */
export type ChartData =
  | BarChartData
  | LineChartData
  | DonutChartData
  | MetricsChartData
  | TableChartData;

/** Wrapper for chart data in API responses */
export interface ChartResponse {
  chart: ChartData;
}

// =============================================================================
// Cart Types
// =============================================================================

export interface CartItem {
  id: string;
  productId: string;
  productName: string;
  sku: string;
  quantity: number;
  unitPrice: number;
  totalPrice: number;
  imageUrl?: string;
  variant?: {
    id: string;
    name: string;
    options: Record<string, string>;
  };
  customFields?: Record<string, any>;
}

export interface Cart {
  id: string;
  storeId: string;
  customerId: string | null;
  customerEmail: string | null;
  items: CartItem[];
  subtotal: number;
  taxAmount: number;
  discountAmount: number;
  total: number;
  itemCount: number;
  couponCode: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
  expiresAt: string;
}

// =============================================================================
// Checkout Types
// =============================================================================

export type CheckoutStep = 'cart' | 'customer' | 'shipping' | 'payment' | 'review' | 'confirmation';

export interface CustomerInfo {
  email: string;
  firstName: string;
  lastName: string;
  phone?: string;
  customerId?: string;
}

export interface ShippingAddress {
  firstName: string;
  lastName: string;
  company?: string;
  address1: string;
  address2?: string;
  city: string;
  state: string;
  postalCode: string;
  country: string;
  phone?: string;
}

export interface BillingAddress extends ShippingAddress {
  sameAsShipping?: boolean;
}

export interface ShippingMethod {
  id: string;
  name: string;
  description: string;
  price: number;
  estimatedDays: string;
  carrier?: string;
}

// =============================================================================
// Authorize.net Types
// =============================================================================

export interface AuthNetConfig {
  clientKey: string;
  apiLoginId: string;
  environment: 'sandbox' | 'production';
}

export interface PaymentMethod {
  type: 'credit_card' | 'ach' | 'saved_card';
  opaqueData?: {
    dataDescriptor: string;
    dataValue: string;
  };
  savedCardId?: string;
  lastFour?: string;
  cardType?: string;
}

export interface AuthNetTransaction {
  transactionId: string;
  authCode: string;
  responseCode: string;
  messageCode: string;
  description: string;
  avsResultCode?: string;
  cvvResultCode?: string;
}

export interface OrderSummary {
  subtotal: number;
  shipping: number;
  tax: number;
  discount: number;
  total: number;
  itemCount: number;
}

export interface OrderResult {
  orderId: string;
  orderNumber: string;
  transactionId: string;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  total: number;
  createdAt: string;
}

// =============================================================================
// Prefetch Data Types
// =============================================================================

export interface AuthPrefetchData {
  user: User | null;
  permissions: string[];
  storeSettings: {
    name: string;
    timezone: string;
    currency: string;
    taxRate: number;
  } | null;
  lastLogin: string | null;
}

export interface CartPrefetchData {
  cart: Cart | null;
  recentCarts: Array<{
    id: string;
    customerId: string | null;
    itemCount: number;
    total: number;
    updatedAt: string;
  }>;
  abandonedCarts: number;
}

export interface CheckoutPrefetchData {
  authNetConfig: AuthNetConfig | null;
  shippingMethods: ShippingMethod[];
  taxRates: Array<{
    state: string;
    rate: number;
  }>;
  savedCards: Array<{
    id: string;
    lastFour: string;
    cardType: string;
    expiryMonth: number;
    expiryYear: number;
    isDefault: boolean;
  }>;
  savedAddresses: Array<ShippingAddress & { id: string; isDefault: boolean }>;
}
