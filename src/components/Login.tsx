import { useState, useEffect } from 'react';
import { Box, Text, useInput } from 'ink';
import { Spinner } from './Spinner.js';
import { authStore } from '../stores/authStore.js';
import { COLORS } from '../theme/colors.js';

interface LoginProps {
  onSuccess: () => void;
}

type Stage = 'email' | 'password' | 'loading';

export function Login({ onSuccess }: LoginProps) {
  const [stage, setStage] = useState<Stage>('email');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);

  // Subscribe to auth store errors
  useEffect(() => {
    return authStore.subscribe((state) => {
      if (state.error) {
        setError(state.error);
        setStage('password');
        setPassword('');
      }
      if (state.isAuthenticated) {
        onSuccess();
      }
    });
  }, [onSuccess]);

  useInput((input, key) => {
    if (stage === 'loading') return;

    // Clear error on any input
    if (error) setError(null);

    if (key.return) {
      if (stage === 'email') {
        if (email.includes('@')) {
          setStage('password');
        } else {
          setError('Please enter a valid email');
        }
      } else if (stage === 'password') {
        handleLogin();
      }
      return;
    }

    if (key.backspace || key.delete) {
      if (stage === 'email') {
        setEmail((prev) => prev.slice(0, -1));
      } else if (stage === 'password') {
        setPassword((prev) => prev.slice(0, -1));
      }
      return;
    }

    if (key.escape) {
      if (stage === 'password') {
        setStage('email');
        setPassword('');
      }
      return;
    }

    // Ignore control characters
    if (key.ctrl || key.meta) return;

    // Add regular characters
    if (input && !key.escape) {
      if (stage === 'email') {
        setEmail((prev) => prev + input);
      } else if (stage === 'password') {
        setPassword((prev) => prev + input);
      }
    }
  });

  const handleLogin = async () => {
    setStage('loading');
    setError(null);

    // Use authStore directly - it handles everything
    const success = await authStore.loginWithPassword(email, password);

    if (!success) {
      // Error will be set via subscription
      setStage('password');
      setPassword('');
    }
    // Success will trigger onSuccess via subscription
  };

  return (
    <Box flexDirection="column" padding={1}>
      <Box marginBottom={1}>
        <Text bold color={COLORS.primary}>wilson</Text>
        <Text color={COLORS.textDim}> - Login</Text>
      </Box>

      {error && (
        <Box marginBottom={1}>
          <Text color={COLORS.error}>✗ {error}</Text>
        </Box>
      )}

      {/* Email input */}
      <Box>
        <Text color={stage === 'email' ? COLORS.info : COLORS.textMuted}>Email: </Text>
        <Text color={COLORS.text}>{email}</Text>
        {stage === 'email' && <Text color={COLORS.primary}>|</Text>}
      </Box>

      {/* Password input */}
      {(stage === 'password' || stage === 'loading') && (
        <Box>
          <Text color={stage === 'password' ? COLORS.info : COLORS.textMuted}>Password: </Text>
          <Text color={COLORS.text}>{'*'.repeat(password.length)}</Text>
          {stage === 'password' && <Text color={COLORS.primary}>|</Text>}
        </Box>
      )}

      {/* Loading */}
      {stage === 'loading' && (
        <Box marginTop={1}>
          <Spinner label="Authenticating..." />
        </Box>
      )}

      {/* Help text */}
      <Box marginTop={1}>
        <Text color={COLORS.textDim}>
          {stage === 'email' && 'Enter your email and press Enter'}
          {stage === 'password' && 'Enter your password and press Enter (Esc to go back)'}
        </Text>
      </Box>
    </Box>
  );
}
