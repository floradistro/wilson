/**
 * Error categorization and helpful suggestions for Wilson CLI
 */

export type ErrorCategory = 'network' | 'auth' | 'tool' | 'validation' | 'rate_limit' | 'system';

export interface CategorizedError {
  message: string;
  category: ErrorCategory;
  suggestion?: string;
  icon: string;
}

/**
 * Categorize an error and provide helpful context
 */
export function categorizeError(error: unknown): CategorizedError {
  const message = extractErrorMessage(error);
  const lowerMessage = message.toLowerCase();

  // Network errors
  if (
    lowerMessage.includes('timeout') ||
    lowerMessage.includes('econnrefused') ||
    lowerMessage.includes('enotfound') ||
    lowerMessage.includes('network') ||
    lowerMessage.includes('fetch failed') ||
    lowerMessage.includes('connection')
  ) {
    return {
      message: truncateMessage(message),
      category: 'network',
      suggestion: 'Check your internet connection and try again',
      icon: '⚡',
    };
  }

  // Authentication errors
  if (
    lowerMessage.includes('401') ||
    lowerMessage.includes('unauthorized') ||
    lowerMessage.includes('invalid credentials') ||
    lowerMessage.includes('token expired') ||
    lowerMessage.includes('authentication') ||
    lowerMessage.includes('not authenticated')
  ) {
    return {
      message: truncateMessage(message),
      category: 'auth',
      suggestion: 'Run /logout and log in again',
      icon: '🔑',
    };
  }

  // Rate limiting
  if (
    lowerMessage.includes('rate limit') ||
    lowerMessage.includes('too many requests') ||
    lowerMessage.includes('429')
  ) {
    return {
      message: truncateMessage(message),
      category: 'rate_limit',
      suggestion: 'Wait a moment and try again',
      icon: '⏳',
    };
  }

  // Tool execution errors
  if (
    lowerMessage.includes('tool') ||
    lowerMessage.includes('command failed') ||
    lowerMessage.includes('permission denied') ||
    lowerMessage.includes('not found') ||
    lowerMessage.includes('no such file')
  ) {
    return {
      message: truncateMessage(message),
      category: 'tool',
      suggestion: 'Check the command or file path',
      icon: '🔧',
    };
  }

  // Validation errors
  if (
    lowerMessage.includes('invalid') ||
    lowerMessage.includes('validation') ||
    lowerMessage.includes('required') ||
    lowerMessage.includes('must be')
  ) {
    return {
      message: truncateMessage(message),
      category: 'validation',
      suggestion: 'Check the input format',
      icon: '⚠',
    };
  }

  // Default: system error
  return {
    message: truncateMessage(message),
    category: 'system',
    suggestion: 'Try again or start a new conversation with /new',
    icon: '✗',
  };
}

/**
 * Extract error message from various error types
 */
function extractErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === 'string') {
    return error;
  }
  if (error && typeof error === 'object' && 'message' in error) {
    return String((error as { message: unknown }).message);
  }
  return 'An unexpected error occurred';
}

/**
 * Truncate long error messages for display
 */
function truncateMessage(message: string, maxLength = 150): string {
  if (message.length <= maxLength) {
    return message;
  }
  return message.slice(0, maxLength - 3) + '...';
}

/**
 * Get duration for status messages based on type
 */
export function getStatusDuration(type: 'info' | 'success' | 'warning' | 'error' | 'complex'): number {
  const durations: Record<string, number> = {
    info: 2000,
    success: 2000,
    warning: 3000,
    error: 5000,
    complex: 5000, // For context/token displays
  };
  return durations[type] || 2000;
}
