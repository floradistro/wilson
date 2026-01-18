import { useState, useEffect, useCallback, useRef } from 'react';
import { Box, Text, useApp, useInput } from 'ink';
import { Chat } from './components/Chat.js';
import { Spinner } from './components/Spinner.js';
import { Login } from './components/Login.js';
import { TodoList } from './components/TodoList.js';
import { AskUserPrompt } from './components/AskUserPrompt.js';
import { PermissionPrompt } from './components/PermissionPrompt.js';
import { StoreSelector } from './components/StoreSelector.js';
import { Footer } from './components/Footer.js';
import { useChat } from './hooks/useChat.js';
import { useAuthStore } from './hooks/useAuthStore.js';
import { config } from './config.js';
import type { Flags, PendingQuestion, PendingPermission } from './types.js';

interface AppProps {
  initialQuery?: string;
  flags: Flags;
  command?: string;
}

type ViewMode = 'chat' | 'help' | 'status';

export function App({ initialQuery, flags, command }: AppProps) {
  const { exit } = useApp();
  const {
    isAuthenticated,
    isLoading: authLoading,
    isInitialized,
    accessToken,
    storeId,
    storeName,
    user,
    logout,
    stores,
    locations,
    currentLocation,
    switchStore,
    setLocation,
    refreshStores,
  } = useAuthStore();

  const { messages, isStreaming, error, todos, usage, toolCallCount, contextTokens, streamingChars, sendMessage, clearMessages, clearError } = useChat();
  const [inputValue, setInputValue] = useState('');
  const [viewMode, setViewMode] = useState<ViewMode>('chat');
  const [initialQuerySent, setInitialQuerySent] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  // State for interactive prompts
  const [pendingQuestion, setPendingQuestion] = useState<PendingQuestion | null>(null);
  const [pendingPermission, setPendingPermission] = useState<PendingPermission | null>(null);

  // State for store/location selector
  const [selectorMode, setSelectorMode] = useState<'store' | 'location' | null>(null);
  const questionResolverRef = useRef<((answer: string) => void) | null>(null);
  const permissionResolverRef = useRef<((allowed: boolean) => void) | null>(null);

  // Callbacks for tool execution
  const handleAskUser = useCallback((question: PendingQuestion): Promise<string> => {
    return new Promise((resolve) => {
      questionResolverRef.current = resolve;
      setPendingQuestion(question);
    });
  }, []);

  const handlePermissionRequest = useCallback((permission: PendingPermission): Promise<boolean> => {
    return new Promise((resolve) => {
      permissionResolverRef.current = resolve;
      setPendingPermission(permission);
    });
  }, []);

  const answerQuestion = useCallback((answer: string) => {
    if (questionResolverRef.current) {
      questionResolverRef.current(answer);
      questionResolverRef.current = null;
    }
    setPendingQuestion(null);
  }, []);

  const resolvePermission = useCallback((allowed: boolean) => {
    if (permissionResolverRef.current) {
      permissionResolverRef.current(allowed);
      permissionResolverRef.current = null;
    }
    setPendingPermission(null);
  }, []);

  // Handle commands
  useEffect(() => {
    if (command === 'logout') {
      logout();
      console.log('Logged out successfully');
      exit();
    } else if (command === 'version') {
      console.log(`wilson v${config.version}`);
      exit();
    }
  }, [command, logout, exit]);

  // Tool callbacks
  const toolCallbacks = {
    onAskUser: handleAskUser,
    onPermissionRequest: handlePermissionRequest,
    skipPermissions: flags.dangerouslySkipPermissions,
  };

  // Handle initial query after auth
  useEffect(() => {
    if (initialQuery && isAuthenticated && accessToken && storeId && !isStreaming && !initialQuerySent) {
      setInitialQuerySent(true);
      sendMessage(initialQuery, accessToken, storeId, toolCallbacks);
    }
  }, [initialQuery, isAuthenticated, accessToken, storeId, isStreaming, initialQuerySent]);

  // Handle keyboard shortcuts - MUST be called before any conditional returns
  useInput((input, key) => {
    // Only handle input when authenticated and in chat mode
    if (!isAuthenticated) return;

    if (key.ctrl && input === 'c') {
      exit();
      return;
    }

    if (key.ctrl && input === 'l') {
      clearMessages();
      setStatusMessage('Conversation cleared');
      setTimeout(() => setStatusMessage(null), 2000);
      return;
    }

    if (key.escape) {
      if (viewMode !== 'chat') {
        setViewMode('chat');
        return;
      }
      if (error) clearError();
      if (statusMessage) setStatusMessage(null);
      return;
    }

    if (input === '?' && !isStreaming && inputValue === '') {
      setViewMode(viewMode === 'help' ? 'chat' : 'help');
    }
  });

  // Handle slash commands
  const handleSlashCommand = (cmd: string): boolean => {
    const lower = cmd.toLowerCase().trim();

    switch (lower) {
      case '/new':
      case '/clear':
        clearMessages();
        setStatusMessage('Conversation cleared');
        setTimeout(() => setStatusMessage(null), 2000);
        return true;

      case '/status':
        setViewMode('status');
        return true;

      case '/help':
      case '/?':
        setViewMode('help');
        return true;

      case '/logout':
      case '/quit':
      case '/exit':
        logout();
        exit();
        return true;

      case '/stores':
      case '/store':
        if (stores.length <= 1) {
          setStatusMessage('Only one store available');
          setTimeout(() => setStatusMessage(null), 2000);
        } else {
          setSelectorMode('store');
        }
        return true;

      case '/locations':
      case '/location':
      case '/loc':
        if (locations.length === 0) {
          setStatusMessage('No locations available for this store');
          setTimeout(() => setStatusMessage(null), 2000);
        } else {
          setSelectorMode('location');
        }
        return true;

      case '/refresh':
      case '/sync':
        setStatusMessage('Refreshing stores...');
        refreshStores().then(() => {
          setStatusMessage(`Synced: ${stores.length} stores`);
          setTimeout(() => setStatusMessage(null), 2000);
        });
        return true;

      case '/context':
      case '/ctx': {
        const pct = ((contextTokens / 200000) * 100).toFixed(1);
        const status = contextTokens > 180000 ? '[!] Critical' : contextTokens > 150000 ? '[!] Warning' : '[ok]';
        setStatusMessage(`Context: ${(contextTokens / 1000).toFixed(1)}K / 200K tokens (${pct}%) ${status}`);
        setTimeout(() => setStatusMessage(null), 5000);
        return true;
      }

      case '/tokens': {
        const total = usage.inputTokens + usage.outputTokens;
        const cost = (usage.inputTokens * 0.000003 + usage.outputTokens * 0.000015).toFixed(4);
        setStatusMessage(`Tokens: ↑${(usage.inputTokens/1000).toFixed(1)}K ↓${(usage.outputTokens/1000).toFixed(1)}K = ${(total/1000).toFixed(1)}K (~$${cost})`);
        setTimeout(() => setStatusMessage(null), 5000);
        return true;
      }

      default:
        return false;
    }
  };

  // Loading state - wait for auth store to initialize
  if (!isInitialized || authLoading) {
    return (
      <Box padding={1}>
        <Spinner label="Loading..." />
      </Box>
    );
  }

  // Login flow - show login if not authenticated
  if (!isAuthenticated && command !== 'logout') {
    return <Login onSuccess={() => {}} />;
  }

  // Help screen
  if (viewMode === 'help') {
    return (
      <Box flexDirection="column" padding={1}>
        <Box marginBottom={1}>
          <Text bold color="green">wilson</Text>
          <Text dimColor> v{config.version}</Text>
        </Box>

        <Box flexDirection="column">
          <Text bold color="white">Slash Commands</Text>
          <Box marginTop={1} flexDirection="column">
            <Text>  <Text color="green">/new</Text>       <Text dimColor>Start fresh conversation</Text></Text>
            <Text>  <Text color="green">/clear</Text>     <Text dimColor>Clear screen</Text></Text>
            <Text>  <Text color="green">/stores</Text>    <Text dimColor>Switch store</Text></Text>
            <Text>  <Text color="green">/location</Text>  <Text dimColor>Switch location</Text></Text>
            <Text>  <Text color="green">/refresh</Text>   <Text dimColor>Sync stores from server</Text></Text>
            <Text>  <Text color="green">/context</Text>   <Text dimColor>Show context window usage</Text></Text>
            <Text>  <Text color="green">/tokens</Text>    <Text dimColor>Show token usage and cost</Text></Text>
            <Text>  <Text color="green">/status</Text>    <Text dimColor>View connection status</Text></Text>
            <Text>  <Text color="green">/help</Text>      <Text dimColor>Show this help</Text></Text>
            <Text>  <Text color="green">/logout</Text>    <Text dimColor>Sign out</Text></Text>
          </Box>
        </Box>

        <Box marginTop={1} flexDirection="column">
          <Text bold color="white">Keyboard Shortcuts</Text>
          <Box marginTop={1} flexDirection="column">
            <Text>  <Text>Ctrl+C</Text>  <Text dimColor>Exit</Text></Text>
            <Text>  <Text>Ctrl+L</Text>  <Text dimColor>Clear chat</Text></Text>
            <Text>  <Text>?</Text>       <Text dimColor>Toggle help</Text></Text>
            <Text>  <Text>Esc</Text>     <Text dimColor>Go back / Dismiss</Text></Text>
          </Box>
        </Box>

        <Box marginTop={1} flexDirection="column">
          <Text bold color="white">CLI Usage</Text>
          <Box marginTop={1} flexDirection="column">
            <Text>  <Text>wilson</Text>           <Text dimColor>Start interactive mode</Text></Text>
            <Text>  <Text>wilson "query"</Text>   <Text dimColor>Run a one-off query</Text></Text>
            <Text>  <Text>wilson logout</Text>    <Text dimColor>Sign out</Text></Text>
            <Text>  <Text>wilson version</Text>   <Text dimColor>Show version</Text></Text>
          </Box>
        </Box>

        <Box marginTop={2}>
          <Text dimColor>Press Esc or ? to close</Text>
        </Box>
      </Box>
    );
  }

  // Status screen
  if (viewMode === 'status') {
    return (
      <Box flexDirection="column" padding={1}>
        <Box marginBottom={1}>
          <Text bold color="green">wilson</Text>
          <Text dimColor> - Status</Text>
        </Box>

        <Box flexDirection="column">
          <Box>
            <Text dimColor>{'Store     '}</Text>
            <Text color="white">{storeName || 'Unknown'}</Text>
            {stores.length > 1 && <Text dimColor> ({stores.length} stores)</Text>}
          </Box>
          {currentLocation && (
            <Box>
              <Text dimColor>{'Location  '}</Text>
              <Text color="white">{currentLocation.name}</Text>
            </Box>
          )}
          <Box>
            <Text dimColor>{'Account   '}</Text>
            <Text color="white">{user?.email || 'Unknown'}</Text>
          </Box>
          <Box>
            <Text dimColor>{'Auth      '}</Text>
            {isAuthenticated ? (
              <><Text color="green">{'●'}</Text><Text dimColor> Connected</Text></>
            ) : (
              <><Text color="yellow">{'○'}</Text><Text dimColor> Not connected</Text></>
            )}
          </Box>
          <Box>
            <Text dimColor>{'Messages  '}</Text>
            <Text color="white">{messages.length}</Text>
          </Box>
          <Box>
            <Text dimColor>{'Version   '}</Text>
            <Text color="white">v{config.version}</Text>
          </Box>
        </Box>

        <Box marginTop={2}>
          <Text dimColor>Press Esc to close</Text>
        </Box>
      </Box>
    );
  }

  const handleSubmit = async (value: string) => {
    const trimmed = value.trim();
    if (!trimmed) return;

    // Check for slash commands (but not file paths like /Users/...)
    // Slash commands are: /word or /?  (short, single word, no spaces before first word)
    const slashCommandMatch = trimmed.match(/^\/([a-z?]+)$/i);
    if (slashCommandMatch) {
      setInputValue('');
      if (handleSlashCommand(trimmed)) {
        return;
      }
      // Unknown slash command, show error
      setStatusMessage(`Unknown command: ${trimmed}`);
      setTimeout(() => setStatusMessage(null), 2000);
      return;
    }

    // Regular message
    if (accessToken && storeId) {
      setInputValue('');
      await sendMessage(trimmed, accessToken, storeId, toolCallbacks);
    }
  };

  // Show all messages - don't filter during streaming
  const displayMessages = messages;

  return (
    <Box flexDirection="column">
      {/* Compact header */}
      <Box paddingX={1}>
        <Text bold color="#7DC87D">wilson</Text>
        <Text color="#444444"> v{config.version}</Text>
        {storeName && <Text color="#444444"> • {storeName}</Text>}
        {currentLocation && <Text color="#555555"> @ {currentLocation.name}</Text>}
      </Box>

      {/* Status message */}
      {statusMessage && (
        <Box paddingX={1}>
          <Text color="#7DC87D">✓</Text>
          <Text color="#666666"> {statusMessage}</Text>
        </Box>
      )}

      {/* Todo List */}
      {todos.length > 0 && <Box paddingX={1}><TodoList todos={todos} /></Box>}

      {/* Chat Messages - no extra spacing */}
      <Box paddingX={1} flexDirection="column">
        <Chat messages={displayMessages} isStreaming={isStreaming} />
      </Box>

      {/* Error Display */}
      {error && (
        <Box paddingX={1}>
          <Text color="#E07070">✗ {error}</Text>
          <Text color="#555555"> (esc)</Text>
        </Box>
      )}

      {/* Ask User Prompt */}
      {pendingQuestion && (
        <Box paddingX={1}>
          <AskUserPrompt
            question={pendingQuestion.question}
            options={pendingQuestion.options}
            onAnswer={answerQuestion}
          />
        </Box>
      )}

      {/* Permission Prompt */}
      {pendingPermission && (
        <Box paddingX={1}>
          <PermissionPrompt
            operation={pendingPermission.operation}
            command={pendingPermission.command}
            onAllow={() => resolvePermission(true)}
            onDeny={() => resolvePermission(false)}
          />
        </Box>
      )}

      {/* Store/Location Selector */}
      {selectorMode && (
        <Box paddingX={1}>
          <StoreSelector
            mode={selectorMode}
            stores={stores}
            locations={locations}
            currentStoreId={storeId}
            currentLocationId={currentLocation?.id || null}
            onSelectStore={async (newStoreId) => {
              const success = await switchStore(newStoreId);
              if (success) {
                setStatusMessage(`Switched to ${stores.find(s => s.storeId === newStoreId)?.storeName}`);
                setTimeout(() => setStatusMessage(null), 2000);
              }
              setSelectorMode(null);
            }}
            onSelectLocation={(locationId) => {
              setLocation(locationId);
              const loc = locations.find(l => l.id === locationId);
              setStatusMessage(loc ? `Location: ${loc.name}` : 'Location cleared');
              setTimeout(() => setStatusMessage(null), 2000);
              setSelectorMode(null);
            }}
            onCancel={() => setSelectorMode(null)}
          />
        </Box>
      )}

      {/* Footer - edge to edge */}
      {!pendingQuestion && !pendingPermission && !selectorMode && (
        <Footer
          inputValue={inputValue}
          onInputChange={setInputValue}
          onSubmit={handleSubmit}
          placeholder="Message wilson..."
          disabled={isStreaming}
          usage={usage}
          toolCallCount={toolCallCount}
          contextTokens={contextTokens}
          streamingChars={streamingChars}
          isStreaming={isStreaming}
        />
      )}
    </Box>
  );
}
