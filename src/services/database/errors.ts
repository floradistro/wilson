/**
 * Database Error Types
 *
 * Typed errors for better error handling and debugging.
 * Each error type maps to a specific failure mode.
 */

export enum DatabaseErrorCode {
  // Network errors
  NETWORK_ERROR = 'NETWORK_ERROR',
  TIMEOUT = 'TIMEOUT',

  // Auth errors
  UNAUTHORIZED = 'UNAUTHORIZED',
  FORBIDDEN = 'FORBIDDEN',

  // Client errors
  NOT_FOUND = 'NOT_FOUND',
  VALIDATION_ERROR = 'VALIDATION_ERROR',
  CONFLICT = 'CONFLICT',

  // Server errors
  SERVER_ERROR = 'SERVER_ERROR',
  SERVICE_UNAVAILABLE = 'SERVICE_UNAVAILABLE',

  // Business logic errors
  INSUFFICIENT_STOCK = 'INSUFFICIENT_STOCK',
  CART_EXPIRED = 'CART_EXPIRED',
  PAYMENT_FAILED = 'PAYMENT_FAILED',

  // Unknown
  UNKNOWN = 'UNKNOWN',
}

export interface DatabaseErrorDetails {
  code: DatabaseErrorCode;
  message: string;
  statusCode?: number;
  endpoint?: string;
  originalError?: Error;
  retryable: boolean;
}

export class DatabaseError extends Error {
  readonly code: DatabaseErrorCode;
  readonly statusCode?: number;
  readonly endpoint?: string;
  readonly originalError?: Error;
  readonly retryable: boolean;

  constructor(details: DatabaseErrorDetails) {
    super(details.message);
    this.name = 'DatabaseError';
    this.code = details.code;
    this.statusCode = details.statusCode;
    this.endpoint = details.endpoint;
    this.originalError = details.originalError;
    this.retryable = details.retryable;

    // Maintains proper stack trace for where error was thrown
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, DatabaseError);
    }
  }

  static fromHttpResponse(response: Response, endpoint: string): DatabaseError {
    const statusCode = response.status;

    let code: DatabaseErrorCode;
    let retryable = false;

    switch (statusCode) {
      case 401:
        code = DatabaseErrorCode.UNAUTHORIZED;
        break;
      case 403:
        code = DatabaseErrorCode.FORBIDDEN;
        break;
      case 404:
        code = DatabaseErrorCode.NOT_FOUND;
        break;
      case 409:
        code = DatabaseErrorCode.CONFLICT;
        break;
      case 422:
        code = DatabaseErrorCode.VALIDATION_ERROR;
        break;
      case 503:
        code = DatabaseErrorCode.SERVICE_UNAVAILABLE;
        retryable = true;
        break;
      default:
        if (statusCode >= 500) {
          code = DatabaseErrorCode.SERVER_ERROR;
          retryable = true;
        } else if (statusCode >= 400) {
          code = DatabaseErrorCode.VALIDATION_ERROR;
        } else {
          code = DatabaseErrorCode.UNKNOWN;
        }
    }

    return new DatabaseError({
      code,
      message: `HTTP ${statusCode}: ${response.statusText}`,
      statusCode,
      endpoint,
      retryable,
    });
  }

  static fromNetworkError(error: Error, endpoint: string): DatabaseError {
    const isTimeout = error.message.includes('timeout') || error.name === 'AbortError';

    return new DatabaseError({
      code: isTimeout ? DatabaseErrorCode.TIMEOUT : DatabaseErrorCode.NETWORK_ERROR,
      message: isTimeout ? 'Request timed out' : `Network error: ${error.message}`,
      endpoint,
      originalError: error,
      retryable: true,
    });
  }

  static notFound(resource: string, id?: string): DatabaseError {
    return new DatabaseError({
      code: DatabaseErrorCode.NOT_FOUND,
      message: id ? `${resource} not found: ${id}` : `${resource} not found`,
      retryable: false,
    });
  }

  static validation(message: string): DatabaseError {
    return new DatabaseError({
      code: DatabaseErrorCode.VALIDATION_ERROR,
      message,
      retryable: false,
    });
  }

  static insufficientStock(productId: string, requested: number, available: number): DatabaseError {
    return new DatabaseError({
      code: DatabaseErrorCode.INSUFFICIENT_STOCK,
      message: `Insufficient stock for product ${productId}: requested ${requested}, available ${available}`,
      retryable: false,
    });
  }

  toJSON(): Record<string, unknown> {
    return {
      name: this.name,
      code: this.code,
      message: this.message,
      statusCode: this.statusCode,
      endpoint: this.endpoint,
      retryable: this.retryable,
    };
  }
}

/**
 * Type guard to check if an error is a DatabaseError
 */
export function isDatabaseError(error: unknown): error is DatabaseError {
  return error instanceof DatabaseError;
}

/**
 * Type guard to check if error is retryable
 */
export function isRetryableError(error: unknown): boolean {
  if (isDatabaseError(error)) {
    return error.retryable;
  }
  return false;
}
