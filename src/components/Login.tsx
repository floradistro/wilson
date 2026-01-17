import { useState } from 'react';
import { Box, Text, useInput } from 'ink';
import { Spinner } from './Spinner.js';
import { loginWithPassword, getUserStore } from '../services/api.js';
import type { StoreInfo } from '../types.js';

interface LoginProps {
  onLogin: (
    accessToken: string,
    refreshToken: string,
    expiresAt: number,
    user: { id: string; email: string },
    storeInfo: StoreInfo
  ) => void;
}

type Stage = 'email' | 'password' | 'loading' | 'error';

export function Login({ onLogin }: LoginProps) {
  const [stage, setStage] = useState<Stage>('email');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loadingMessage, setLoadingMessage] = useState('Logging in...');

  useInput((input, key) => {
    if (stage === 'loading') return;

    if (key.return) {
      if (stage === 'email') {
        if (email.includes('@')) {
          setStage('password');
        } else {
          setError('Please enter a valid email');
          setStage('error');
          setTimeout(() => {
            setError('');
            setStage('email');
          }, 2000);
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
    setLoadingMessage('Authenticating...');

    // Step 1: Login
    const authResult = await loginWithPassword(email, password);

    if (!authResult) {
      setError('Invalid email or password');
      setStage('error');
      setTimeout(() => {
        setError('');
        setPassword('');
        setStage('password');
      }, 2000);
      return;
    }

    // Step 2: Get store info
    setLoadingMessage('Loading store info...');
    const storeInfo = await getUserStore(authResult.user.id);

    if (!storeInfo) {
      setError('No store found for this account');
      setStage('error');
      setTimeout(() => {
        setError('');
        setPassword('');
        setStage('password');
      }, 3000);
      return;
    }

    // Success!
    onLogin(
      authResult.accessToken,
      authResult.refreshToken,
      authResult.expiresAt,
      authResult.user,
      storeInfo
    );
  };

  return (
    <Box flexDirection="column" padding={1}>
      <Box marginBottom={1}>
        <Text bold color="green">wilson</Text>
        <Text dimColor> - Login</Text>
      </Box>

      {stage === 'error' && (
        <Box marginBottom={1}>
          <Text color="red">{error}</Text>
        </Box>
      )}

      {/* Email input */}
      <Box>
        <Text color={stage === 'email' ? 'blue' : 'gray'}>Email: </Text>
        <Text>{email}</Text>
        {stage === 'email' && <Text color="green">|</Text>}
      </Box>

      {/* Password input */}
      {(stage === 'password' || stage === 'loading') && (
        <Box>
          <Text color={stage === 'password' ? 'blue' : 'gray'}>Password: </Text>
          <Text>{'*'.repeat(password.length)}</Text>
          {stage === 'password' && <Text color="green">|</Text>}
        </Box>
      )}

      {/* Loading */}
      {stage === 'loading' && (
        <Box marginTop={1}>
          <Spinner label={loadingMessage} />
        </Box>
      )}

      {/* Help text */}
      <Box marginTop={1}>
        <Text dimColor>
          {stage === 'email' && 'Enter your email and press Enter'}
          {stage === 'password' && 'Enter your password and press Enter (Esc to go back)'}
        </Text>
      </Box>
    </Box>
  );
}
