import React, { Component, ErrorInfo, ReactNode } from 'react';
import { Box, Text } from 'ink';
import { COLORS } from '../theme/colors.js';
import { ICONS } from '../theme/ui.js';
import { DESIGN_SYSTEM } from '../theme/design-system.js';

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
  onError?: (error: Error, errorInfo: ErrorInfo) => void;
}

interface State {
  hasError: boolean;
  error?: Error;
  errorInfo?: ErrorInfo;
  retryCount: number;
}

export class EnhancedErrorBoundary extends Component<Props, State> {
  private retryTimeoutId?: NodeJS.Timeout;

  constructor(props: Props) {
    super(props);
    this.state = { 
      hasError: false, 
      retryCount: 0 
    };
  }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    this.setState({ errorInfo });
    
    // Log error for debugging
    console.error('Wilson encountered an error:', error);
    console.error('Component stack:', errorInfo.componentStack);
    
    // Call optional error handler
    this.props.onError?.(error, errorInfo);
    
    // Auto-retry logic for recoverable errors
    this.scheduleRetry();
  }

  scheduleRetry = () => {
    const { retryCount } = this.state;
    
    // Maximum 3 automatic retries with exponential backoff
    if (retryCount < 3) {
      const delay = Math.min(1000 * Math.pow(2, retryCount), 8000);
      
      this.retryTimeoutId = setTimeout(() => {
        this.setState(state => ({
          hasError: false,
          error: undefined,
          errorInfo: undefined,
          retryCount: state.retryCount + 1,
        }));
      }, delay);
    }
  };

  handleManualRetry = () => {
    this.setState({
      hasError: false,
      error: undefined,
      errorInfo: undefined,
      retryCount: 0,
    });
  };

  componentWillUnmount() {
    if (this.retryTimeoutId) {
      clearTimeout(this.retryTimeoutId);
    }
  }

  getErrorType(error?: Error): 'network' | 'auth' | 'parse' | 'runtime' | 'unknown' {
    if (!error) return 'unknown';
    
    const message = error.message.toLowerCase();
    
    if (message.includes('network') || message.includes('fetch') || message.includes('connection')) {
      return 'network';
    }
    if (message.includes('auth') || message.includes('unauthorized') || message.includes('token')) {
      return 'auth';
    }
    if (message.includes('json') || message.includes('parse')) {
      return 'parse';
    }
    
    return 'runtime';
  }

  getErrorSeverity(error?: Error): 'low' | 'medium' | 'high' | 'critical' {
    if (!error) return 'medium';
    
    const type = this.getErrorType(error);
    
    switch (type) {
      case 'network':
        return 'medium'; // Usually recoverable
      case 'auth':
        return 'high';   // Requires user action
      case 'parse':
        return 'low';    // Often temporary
      case 'runtime':
        return 'high';   // Code issue
      default:
        return 'medium';
    }
  }

  getRecoveryInstructions(error?: Error): string[] {
    const type = this.getErrorType(error);
    
    switch (type) {
      case 'network':
        return [
          'Check your internet connection',
          'Try again in a few moments',
          'Verify VPN settings if applicable',
        ];
      case 'auth':
        return [
          'Your session may have expired',
          'Try logging out and back in',
          'Contact support if the issue persists',
        ];
      case 'parse':
        return [
          'This appears to be a temporary data issue',
          'The system will retry automatically',
          'Try refreshing if the problem continues',
        ];
      case 'runtime':
        return [
          'A code error occurred',
          'Please report this issue',
          'Try restarting Wilson',
        ];
      default:
        return [
          'An unexpected error occurred',
          'Try restarting Wilson',
          'Contact support if the issue persists',
        ];
    }
  }

  render() {
    if (this.state.hasError) {
      // Use custom fallback if provided
      if (this.props.fallback) {
        return this.props.fallback;
      }

      const { error, retryCount } = this.state;
      const errorType = this.getErrorType(error);
      const errorSeverity = this.getErrorSeverity(error);
      const recoveryInstructions = this.getRecoveryInstructions(error);
      
      const isRetrying = retryCount > 0 && retryCount < 3;
      const hasExhaustedRetries = retryCount >= 3;

      return (
        <Box 
          flexDirection="column" 
          padding={2}
          borderStyle="round"
          borderColor={COLORS.error}
        >
          {/* Error Header */}
          <Box marginBottom={2} alignItems="center">
            <Text color={COLORS.error} bold>
              {ICONS.error} Wilson encountered an error
            </Text>
            {errorSeverity === 'critical' && (
              <Text color={COLORS.error} marginLeft={2}>
                (Critical)
              </Text>
            )}
          </Box>

          {/* Error Type Badge */}
          <Box marginBottom={1}>
            <Text 
              color={COLORS.textMuted}
              backgroundColor={DESIGN_SYSTEM.semantic.surface.secondary}
              paddingX={1}
            >
              {errorType.toUpperCase()} ERROR
            </Text>
          </Box>

          {/* Error Message */}
          <Box marginBottom={2}>
            <Text color={COLORS.textMuted}>
              {error?.message || 'An unknown error occurred'}
            </Text>
          </Box>

          {/* Recovery Instructions */}
          <Box flexDirection="column" marginBottom={2}>
            <Text color={COLORS.text} bold marginBottom={1}>
              What you can do:
            </Text>
            {recoveryInstructions.map((instruction, index) => (
              <Box key={index} marginBottom={0}>
                <Text color={COLORS.textMuted}>
                  {ICONS.bullet} {instruction}
                </Text>
              </Box>
            ))}
          </Box>

          {/* Retry Status */}
          {isRetrying && (
            <Box marginBottom={1}>
              <Text color={COLORS.warning}>
                {ICONS.running} Automatically retrying... (Attempt {retryCount}/3)
              </Text>
            </Box>
          )}

          {/* Manual Actions */}
          <Box flexDirection="column">
            {!isRetrying && (
              <Box marginBottom={1}>
                <Text color={COLORS.primary}>
                  {ICONS.chevron} Press any key to retry manually
                </Text>
              </Box>
            )}
            
            {hasExhaustedRetries && (
              <Box marginBottom={1}>
                <Text color={COLORS.warning}>
                  {ICONS.warning} Automatic retries exhausted. Manual retry available.
                </Text>
              </Box>
            )}

            <Box>
              <Text color={COLORS.textDim}>
                Press Ctrl+C to exit Wilson
              </Text>
            </Box>
          </Box>

          {/* Debug Info (collapsed by default) */}
          <Box marginTop={2} flexDirection="column">
            <Text color={COLORS.textVeryDim}>
              {ICONS.ellipsis} Error Details:
            </Text>
            <Box marginLeft={2}>
              <Text color={COLORS.textVeryDim}>
                Type: {error?.name || 'Unknown'}
              </Text>
              <Text color={COLORS.textVeryDim}>
                Component: {this.state.errorInfo?.componentStack?.split('\n')[1]?.trim() || 'Unknown'}
              </Text>
            </Box>
          </Box>
        </Box>
      );
    }

    return this.props.children;
  }
}

/**
 * Async error boundary for promise-based errors
 */
export function useAsyncErrorBoundary() {
  const [, setError] = React.useState();
  
  return React.useCallback((error: Error) => {
    setError(() => {
      throw error;
    });
  }, []);
}

/**
 * HOC to wrap components with enhanced error boundary
 */
export function withErrorBoundary<P extends object>(
  Component: React.ComponentType<P>,
  fallback?: ReactNode,
  onError?: (error: Error, errorInfo: ErrorInfo) => void
) {
  const WrappedComponent = (props: P) => (
    <EnhancedErrorBoundary fallback={fallback} onError={onError}>
      <Component {...props} />
    </EnhancedErrorBoundary>
  );

  WrappedComponent.displayName = `withErrorBoundary(${Component.displayName || Component.name})`;
  
  return WrappedComponent;
}