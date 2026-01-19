import { useState, useEffect, useCallback, useRef } from 'react';
import { Box, Text, useApp, useInput } from 'ink';
import { Chat } from './components/Chat.js';
import { Spinner } from './components/Spinner.js';
import { Login } from './components/Login.js';
import { TodoList } from './components/TodoList.js';
import { AskUserPrompt } from './components/AskUserPrompt.js';
import { PermissionPrompt } from './components/PermissionPrompt.js';
import { StoreSelector } from './components/StoreSelector.js';
import { ConfigView } from './components/ConfigView.js';
import { Footer } from './components/Footer.js';
import { SwarmLauncher } from './components/SwarmView.js';
import { useChat } from './hooks/useChat.js';
import { useAuthStore } from './hooks/useAuthStore.js';
import { config } from './config.js';
import { COLORS } from './theme/colors.js';
import { SLASH_COMMANDS, KEYBOARD_SHORTCUTS, findSimilarCommands } from './help/commands.js';
import { categorizeError, getStatusDuration } from './utils/errors.js';
import type { Flags, PendingQuestion, PendingPermission } from './types.js';

interface AppProps {
  initialQuery?: string;
  flags: Flags;
  command?: string;
}

type ViewMode = 'chat' | 'help' | 'status' | 'config' | 'rules' | 'swarm';
type StatusType = 'info' | 'success' | 'warning' | 'error' | 'complex';
type LoadingStage = 'initializing' | 'authenticating' | 'loading_stores';

interface StatusMessage {
  text: string;
  type: StatusType;
}

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
  const [statusMessage, setStatusMessage] = useState<StatusMessage | null>(null);
  const [loadingStage, setLoadingStage] = useState<LoadingStage>('initializing');
  const statusTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Helper to show status message with appropriate duration
  const showStatus = useCallback((text: string, type: StatusType = 'info') => {
    // Clear any existing timeout
    if (statusTimeoutRef.current) {
      clearTimeout(statusTimeoutRef.current);
    }
    setStatusMessage({ text, type });
    const duration = getStatusDuration(type);
    statusTimeoutRef.current = setTimeout(() => setStatusMessage(null), duration);
  }, []);

  // State for interactive prompts
  const [pendingQuestion, setPendingQuestion] = useState<PendingQuestion | null>(null);
  const [pendingPermission, setPendingPermission] = useState<PendingPermission | null>(null);

  // State for store/location selector
  const [selectorMode, setSelectorMode] = useState<'store' | 'location' | null>(null);

  // Swarm state
  const [swarmGoal, setSwarmGoal] = useState<string | null>(null);
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

  // Auto-check for updates on startup
  useEffect(() => {
    if (isAuthenticated && isInitialized && !command) {
      // Only check for updates in normal interactive mode
      import('./services/updater.js').then(({ updater }) => {
        updater.autoUpdate().catch(() => {
          // Silently ignore update check failures
        });
      });
    }
  }, [isAuthenticated, isInitialized, command]);

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
      showStatus('Conversation cleared', 'success');
      return;
    }

    if (key.escape) {
      if (viewMode !== 'chat') {
        setViewMode('chat');
        return;
      }
      if (error) clearError();
      if (statusMessage) {
        if (statusTimeoutRef.current) clearTimeout(statusTimeoutRef.current);
        setStatusMessage(null);
      }
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
        showStatus('Conversation cleared', 'success');
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
          showStatus('Only one store available', 'info');
        } else {
          setSelectorMode('store');
        }
        return true;

      case '/locations':
      case '/location':
      case '/loc':
        if (locations.length === 0) {
          showStatus('No locations available for this store', 'info');
        } else {
          setSelectorMode('location');
        }
        return true;

      case '/refresh':
      case '/sync':
        showStatus('Refreshing stores...', 'info');
        refreshStores().then(() => {
          showStatus(`Synced: ${stores.length} stores`, 'success');
        });
        return true;

      case '/context':
      case '/ctx': {
        const pct = ((contextTokens / 200000) * 100).toFixed(1);
        const ctxType: StatusType = contextTokens > 180000 ? 'error' : contextTokens > 150000 ? 'warning' : 'success';
        const status = contextTokens > 180000 ? 'Critical' : contextTokens > 150000 ? 'Warning' : 'OK';
        showStatus(`Context: ${(contextTokens / 1000).toFixed(1)}K / 200K tokens (${pct}%) [${status}]`, 'complex');
        return true;
      }

      case '/tokens': {
        const total = usage.inputTokens + usage.outputTokens;
        const cost = (usage.inputTokens * 0.000003 + usage.outputTokens * 0.000015).toFixed(4);
        showStatus(`Tokens: ↑${(usage.inputTokens/1000).toFixed(1)}K ↓${(usage.outputTokens/1000).toFixed(1)}K = ${(total/1000).toFixed(1)}K (~$${cost})`, 'complex');
        return true;
      }

      // Config commands - interactive views with inline editing
      case '/config':
      case '/settings':
        setViewMode('config');
        return true;

      case '/rules':
      case '/memory':
        setViewMode('rules');
        return true;

      // Swarm commands
      case '/swarm status': {
        import('./swarm/commander.js').then(mod => {
          const status = mod.getSwarmStatus(process.cwd());
          if (status) {
            const progress = Math.round((status.completedTasks.length / (status.goalQueue.length + status.completedTasks.length + status.failedTasks.length)) * 100) || 0;
            showStatus(`Swarm: ${status.status} | ${progress}% | ${status.completedTasks.length} done, ${status.failedTasks.length} failed`, 'complex');
          } else {
            showStatus('No swarm running in this directory', 'info');
          }
        });
        return true;
      }

      case '/swarm stop':
      case '/swarm kill': {
        import('./swarm/commander.js').then(mod => {
          mod.stopSwarm(process.cwd());
          showStatus('Swarm stopped', 'success');
        });
        return true;
      }

      default:
        return false;
    }
  };

  // Loading state - wait for auth store to initialize
  if (!isInitialized || authLoading) {
    const loadingMessages: Record<LoadingStage, string> = {
      initializing: 'Initializing...',
      authenticating: 'Checking authentication...',
      loading_stores: 'Loading stores...',
    };
    return (
      <Box padding={1}>
        <Spinner label={loadingMessages[loadingStage]} />
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
          <Text bold color={COLORS.primary}>wilson</Text>
          <Text color={COLORS.textDim}> v{config.version}</Text>
        </Box>

        <Box flexDirection="column">
          <Text bold color={COLORS.text}>Slash Commands</Text>
          <Box marginTop={1} flexDirection="column">
            {SLASH_COMMANDS.map(cmd => (
              <Box key={cmd.name}>
                <Text>  </Text>
                <Text color={COLORS.primary}>/{cmd.name.padEnd(10)}</Text>
                {cmd.aliases.length > 0 && (
                  <Text color={COLORS.textVeryDim}> ({cmd.aliases.join(', ').padEnd(12)})</Text>
                )}
                {cmd.aliases.length === 0 && <Text color={COLORS.textVeryDim}>{' '.repeat(15)}</Text>}
                <Text color={COLORS.textDim}> {cmd.description}</Text>
              </Box>
            ))}
          </Box>
        </Box>

        <Box marginTop={1} flexDirection="column">
          <Text bold color={COLORS.text}>Keyboard Shortcuts</Text>
          <Box marginTop={1} flexDirection="column">
            {KEYBOARD_SHORTCUTS.map(shortcut => (
              <Box key={shortcut.key}>
                <Text>  </Text>
                <Text color={COLORS.text}>{shortcut.key.padEnd(8)}</Text>
                <Text color={COLORS.textDim}> {shortcut.description}</Text>
              </Box>
            ))}
          </Box>
        </Box>

        <Box marginTop={1} flexDirection="column">
          <Text bold color={COLORS.text}>CLI Usage</Text>
          <Box marginTop={1} flexDirection="column">
            <Text>  <Text color={COLORS.text}>wilson</Text>           <Text color={COLORS.textDim}>Start interactive mode</Text></Text>
            <Text>  <Text color={COLORS.text}>wilson "query"</Text>   <Text color={COLORS.textDim}>Run a one-off query</Text></Text>
            <Text>  <Text color={COLORS.text}>wilson logout</Text>    <Text color={COLORS.textDim}>Sign out</Text></Text>
            <Text>  <Text color={COLORS.text}>wilson version</Text>   <Text color={COLORS.textDim}>Show version</Text></Text>
          </Box>
        </Box>

        <Box marginTop={2}>
          <Text color={COLORS.textDim}>Press Esc or ? to close</Text>
        </Box>
      </Box>
    );
  }

  // Status screen
  if (viewMode === 'status') {
    return (
      <Box flexDirection="column" padding={1}>
        <Box marginBottom={1}>
          <Text bold color={COLORS.primary}>wilson</Text>
          <Text color={COLORS.textDim}> - Status</Text>
        </Box>

        <Box flexDirection="column">
          <Box>
            <Text color={COLORS.textDim}>{'Store     '}</Text>
            <Text color={COLORS.text}>{storeName || 'Unknown'}</Text>
            {stores.length > 1 && <Text color={COLORS.textDim}> ({stores.length} stores)</Text>}
          </Box>
          {currentLocation && (
            <Box>
              <Text color={COLORS.textDim}>{'Location  '}</Text>
              <Text color={COLORS.text}>{currentLocation.name}</Text>
            </Box>
          )}
          <Box>
            <Text color={COLORS.textDim}>{'Account   '}</Text>
            <Text color={COLORS.text}>{user?.email || 'Unknown'}</Text>
          </Box>
          <Box>
            <Text color={COLORS.textDim}>{'Auth      '}</Text>
            {isAuthenticated ? (
              <><Text color={COLORS.success}>● Connected</Text></>
            ) : (
              <><Text color={COLORS.warning}>○ Not connected</Text></>
            )}
          </Box>
          <Box>
            <Text color={COLORS.textDim}>{'Messages  '}</Text>
            <Text color={COLORS.text}>{messages.length}</Text>
          </Box>
          <Box>
            <Text color={COLORS.textDim}>{'Version   '}</Text>
            <Text color={COLORS.text}>v{config.version}</Text>
          </Box>
        </Box>

        <Box marginTop={2}>
          <Text color={COLORS.textDim}>Press Esc to close</Text>
        </Box>
      </Box>
    );
  }

  // Config view
  if (viewMode === 'config') {
    return <ConfigView mode="settings" onExit={() => setViewMode('chat')} />;
  }

  // Rules view
  if (viewMode === 'rules') {
    return <ConfigView mode="rules" onExit={() => setViewMode('chat')} />;
  }

  // Swarm view
  if (viewMode === 'swarm' && swarmGoal && accessToken && storeId) {
    return (
      <SwarmLauncher
        goal={swarmGoal}
        accessToken={accessToken}
        storeId={storeId}
        workerCount={4}
        onExit={() => {
          setSwarmGoal(null);
          setViewMode('chat');
        }}
      />
    );
  }

  const handleSubmit = async (value: string) => {
    const trimmed = value.trim();
    if (!trimmed) return;

    // IMPORTANT: Check /swarm commands FIRST (before general slash command matching)
    // /swarm "goal" - start a swarm with the given goal
    if (trimmed.toLowerCase().startsWith('/swarm ')) {
      setInputValue('');
      const afterSwarm = trimmed.slice(7).trim(); // Remove "/swarm "

      // Check for subcommands
      if (afterSwarm.toLowerCase() === 'status') {
        handleSlashCommand('/swarm status');
        return;
      }
      if (afterSwarm.toLowerCase() === 'stop' || afterSwarm.toLowerCase() === 'kill') {
        handleSlashCommand('/swarm stop');
        return;
      }

      // Otherwise it's a goal - strip quotes if present
      const goal = afterSwarm.replace(/^["']|["']$/g, '').trim();
      if (goal) {
        setSwarmGoal(goal);
        setViewMode('swarm');
      } else {
        showStatus('Usage: /swarm "your goal here"', 'warning');
      }
      return;
    }

    // Check for slash commands (but not file paths like /Users/...)
    // Slash commands are: /word or /word word (e.g., /config edit)
    const slashCommandMatch = trimmed.match(/^\/([a-z?]+(?:\s+[a-z]+)?)$/i);
    if (slashCommandMatch) {
      setInputValue('');
      if (handleSlashCommand(trimmed)) {
        return;
      }
      // Unknown slash command - suggest similar commands
      const suggestions = findSimilarCommands(trimmed);
      if (suggestions.length > 0) {
        showStatus(`Unknown command: ${trimmed}. Did you mean: /${suggestions.join(', /')}?`, 'warning');
      } else {
        showStatus(`Unknown command: ${trimmed}. Type /help for available commands.`, 'warning');
      }
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

  // Get status icon based on type
  const getStatusIcon = (type: StatusType) => {
    switch (type) {
      case 'success': return '✓';
      case 'error': return '✗';
      case 'warning': return '!';
      case 'complex': return '◆';
      default: return '•';
    }
  };

  const getStatusColor = (type: StatusType) => {
    switch (type) {
      case 'success': return COLORS.success;
      case 'error': return COLORS.error;
      case 'warning': return COLORS.warning;
      default: return COLORS.info;
    }
  };

  return (
    <Box flexDirection="column">
      {/* Minimal header - with breathing room */}
      <Box paddingX={1} marginBottom={1}>
        <Text bold color={COLORS.primary}>wilson</Text>
        <Text color={COLORS.textDisabled}> │ </Text>
        {storeName && (
          <>
            <Text color={COLORS.textMuted}>{storeName}</Text>
            {currentLocation && (
              <>
                <Text color={COLORS.textVeryDim}> → </Text>
                <Text color={COLORS.textDim}>{currentLocation.name}</Text>
              </>
            )}
          </>
        )}
      </Box>

      {/* Status message */}
      {statusMessage && (
        <Box paddingX={1} marginBottom={1}>
          <Text color={getStatusColor(statusMessage.type)}>{getStatusIcon(statusMessage.type)}</Text>
          <Text color={COLORS.textMuted}> {statusMessage.text}</Text>
          <Text color={COLORS.textVeryDim}> (esc)</Text>
        </Box>
      )}

      {/* Todo List */}
      {todos.length > 0 && <Box paddingX={1} marginBottom={1}><TodoList todos={todos} /></Box>}

      {/* Chat Messages - generous spacing */}
      <Box paddingX={1} flexDirection="column" marginBottom={1}>
        <Chat messages={displayMessages} isStreaming={isStreaming} />
      </Box>

      {/* Error Display with categorization */}
      {error && (() => {
        const categorized = categorizeError(error);
        return (
          <Box paddingX={1} flexDirection="column">
            <Box>
              <Text color={COLORS.error}>{categorized.icon} {categorized.message}</Text>
              <Text color={COLORS.textDim}> (esc)</Text>
            </Box>
            {categorized.suggestion && (
              <Box marginLeft={2}>
                <Text color={COLORS.info}>→ {categorized.suggestion}</Text>
              </Box>
            )}
          </Box>
        );
      })()}

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
                showStatus(`Switched to ${stores.find(s => s.storeId === newStoreId)?.storeName}`, 'success');
              }
              setSelectorMode(null);
            }}
            onSelectLocation={(locationId) => {
              setLocation(locationId);
              const loc = locations.find(l => l.id === locationId);
              showStatus(loc ? `Location: ${loc.name}` : 'Location cleared', 'success');
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
