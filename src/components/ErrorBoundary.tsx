import { Component, ReactNode } from 'react';
import { Box, Text } from 'ink';
import { log } from '../utils/logger.js';

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: { componentStack: string }) {
    log.error('React Error Boundary caught error', {
      error: error.message,
      stack: error.stack,
      componentStack: errorInfo.componentStack,
    });
  }

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }

      return (
        <Box flexDirection="column" padding={1}>
          <Text color="red" bold>Something went wrong</Text>
          <Text color="gray">{this.state.error?.message || 'Unknown error'}</Text>
          <Box marginTop={1}>
            <Text color="gray" dimColor>Press Ctrl+C to exit and try again</Text>
          </Box>
        </Box>
      );
    }

    return this.props.children;
  }
}
