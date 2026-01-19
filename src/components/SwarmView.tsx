import React, { useState, useEffect, useCallback } from 'react';
import { Box, Text, useInput, useApp } from 'ink';
import { Spinner } from './Spinner.js';
import { COLORS } from '../theme/colors.js';
import type { SwarmState, SwarmWorker, SwarmTask } from '../swarm/types.js';
import { getIPCPaths, readState, calculateProgress, isSwarmComplete } from '../swarm/queue.js';
import { isTmuxAvailable, attachSession, killSession } from '../swarm/tmux.js';
import { startSwarm, stopSwarm } from '../swarm/commander.js';

interface SwarmViewProps {
  goal: string;
  accessToken: string;
  storeId: string;
  workerCount?: number;
  onExit: () => void;
}

type SwarmPhase = 'checking' | 'starting' | 'running' | 'attaching' | 'error' | 'completed';

export function SwarmView({ goal, accessToken, storeId, workerCount = 4, onExit }: SwarmViewProps) {
  const { exit } = useApp();
  const [phase, setPhase] = useState<SwarmPhase>('checking');
  const [state, setState] = useState<SwarmState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedWorker, setSelectedWorker] = useState<number>(0);

  // Check tmux and start swarm
  useEffect(() => {
    const init = async () => {
      // Check tmux
      if (!isTmuxAvailable()) {
        setError('tmux is required for swarm mode.\n\nInstall with: brew install tmux');
        setPhase('error');
        return;
      }

      setPhase('starting');

      try {
        const swarmState = await startSwarm({
          goal,
          workerCount,
          workingDirectory: process.cwd(),
          accessToken,
          storeId,
        });

        setState(swarmState);
        setPhase('running');

        // Auto-attach to tmux after a short delay
        setTimeout(() => {
          setPhase('attaching');
          // Small delay before attaching
          setTimeout(() => {
            attachSession(swarmState.tmuxSession);
            exit(); // Exit after tmux session ends
          }, 500);
        }, 2000);
      } catch (err: any) {
        setError(err.message);
        setPhase('error');
      }
    };

    init();
  }, [goal, accessToken, storeId, workerCount, exit]);

  // Poll for state updates when running
  useEffect(() => {
    if (phase !== 'running' || !state) return;

    const paths = getIPCPaths(process.cwd());
    const interval = setInterval(() => {
      const newState = readState(paths);
      if (newState) {
        setState(newState);
        if (newState.status === 'completed') {
          setPhase('completed');
        }
      }
    }, 1000);

    return () => clearInterval(interval);
  }, [phase, state]);

  // Handle keyboard input
  useInput((input, key) => {
    if (key.escape || (key.ctrl && input === 'c')) {
      if (state?.tmuxSession) {
        stopSwarm(process.cwd());
      }
      onExit();
      return;
    }

    if (phase === 'error') {
      onExit();
      return;
    }

    // Worker selection
    if (state && phase === 'running') {
      if (key.upArrow && selectedWorker > 0) {
        setSelectedWorker(prev => prev - 1);
      }
      if (key.downArrow && selectedWorker < state.workers.length - 1) {
        setSelectedWorker(prev => prev + 1);
      }
      // Focus worker on enter
      if (key.return) {
        // Will implement focus when tmux support is added
      }
    }
  });

  // Checking phase
  if (phase === 'checking') {
    return (
      <Box flexDirection="column" padding={1}>
        <Spinner label="Checking tmux availability..." />
      </Box>
    );
  }

  // Error phase
  if (phase === 'error') {
    return (
      <Box flexDirection="column" padding={1}>
        <Box marginBottom={1}>
          <Text color={COLORS.error}>Swarm Error</Text>
        </Box>
        <Box>
          <Text color={COLORS.textDim}>{error}</Text>
        </Box>
        <Box marginTop={1}>
          <Text color={COLORS.textVeryDim}>Press any key to continue...</Text>
        </Box>
      </Box>
    );
  }

  // Starting phase
  if (phase === 'starting') {
    return (
      <Box flexDirection="column" padding={1}>
        <Box marginBottom={1}>
          <Text bold color={COLORS.primary}>Swarm</Text>
          <Text color={COLORS.textDim}> - Initializing</Text>
        </Box>
        <Box flexDirection="column" marginLeft={2}>
          <Spinner label="Decomposing goal into tasks..." />
          <Box marginTop={1}>
            <Text color={COLORS.textDim}>Goal: {goal}</Text>
          </Box>
          <Box>
            <Text color={COLORS.textDim}>Workers: {workerCount}</Text>
          </Box>
        </Box>
      </Box>
    );
  }

  // Attaching phase
  if (phase === 'attaching') {
    return (
      <Box flexDirection="column" padding={1}>
        <Box marginBottom={1}>
          <Text bold color={COLORS.primary}>Swarm</Text>
          <Text color={COLORS.success}> - Ready</Text>
        </Box>
        <Box flexDirection="column" marginLeft={2}>
          <Spinner label="Attaching to tmux session..." />
          <Box marginTop={1}>
            <Text color={COLORS.textDim}>Session: {state?.tmuxSession}</Text>
          </Box>
        </Box>
      </Box>
    );
  }

  // Completed phase
  if (phase === 'completed' && state) {
    return (
      <Box flexDirection="column" padding={1}>
        <Box marginBottom={1}>
          <Text bold color={COLORS.success}>Swarm Complete!</Text>
        </Box>
        <Box flexDirection="column" marginLeft={2}>
          <Box>
            <Text color={COLORS.text}>Tasks completed: {state.completedTasks.length}</Text>
          </Box>
          <Box>
            <Text color={state.failedTasks.length > 0 ? COLORS.error : COLORS.text}>
              Tasks failed: {state.failedTasks.length}
            </Text>
          </Box>
        </Box>
        <Box marginTop={1}>
          <Text color={COLORS.textVeryDim}>Press Esc to continue...</Text>
        </Box>
      </Box>
    );
  }

  // Running phase - show status before attaching
  if (!state) return null;

  const progress = calculateProgress(state);
  const progressBarWidth = 30;
  const filledWidth = Math.round((progress / 100) * progressBarWidth);

  return (
    <Box flexDirection="column" padding={1}>
      {/* Header */}
      <Box marginBottom={1}>
        <Text bold color={COLORS.primary}>Swarm</Text>
        <Text color={COLORS.success}> - Running</Text>
      </Box>

      {/* Goal */}
      <Box marginBottom={1} marginLeft={2}>
        <Text color={COLORS.textDim}>Goal: </Text>
        <Text color={COLORS.text}>{goal.slice(0, 50)}{goal.length > 50 ? '...' : ''}</Text>
      </Box>

      {/* Progress bar */}
      <Box marginBottom={1} marginLeft={2}>
        <Text color={COLORS.textDim}>Progress: </Text>
        <Text color={COLORS.primary}>{'█'.repeat(filledWidth)}</Text>
        <Text color={COLORS.textVeryDim}>{'░'.repeat(progressBarWidth - filledWidth)}</Text>
        <Text color={COLORS.text}> {progress}%</Text>
      </Box>

      {/* Workers */}
      <Box flexDirection="column" marginLeft={2}>
        <Text color={COLORS.textDim} bold>Workers:</Text>
        {state.workers.map((worker, index) => (
          <WorkerRow
            key={worker.id}
            worker={worker}
            task={state.goalQueue.find(t => t.id === worker.currentTaskId)}
            isSelected={index === selectedWorker}
          />
        ))}
      </Box>

      {/* Validator */}
      <Box marginTop={1} marginLeft={2}>
        <Text color={COLORS.textDim} bold>Validator: </Text>
        <Text color={state.validator.status === 'validating' ? COLORS.warning : COLORS.textDim}>
          {state.validator.status}
        </Text>
        <Text color={COLORS.textVeryDim}>
          {' '}({state.validator.validationsPassed} passed, {state.validator.validationsFailed} failed)
        </Text>
      </Box>

      {/* Stats */}
      <Box marginTop={1} marginLeft={2}>
        <Text color={COLORS.success}>Completed: {state.completedTasks.length}</Text>
        <Text color={COLORS.textDim}> | </Text>
        <Text color={COLORS.error}>Failed: {state.failedTasks.length}</Text>
        <Text color={COLORS.textDim}> | </Text>
        <Text color={COLORS.info}>Pending: {state.goalQueue.filter(t => t.status === 'pending').length}</Text>
      </Box>

      {/* Footer */}
      <Box marginTop={1}>
        <Text color={COLORS.textVeryDim}>Attaching to tmux shortly... Press Ctrl+C to cancel</Text>
      </Box>
    </Box>
  );
}

// Worker row component
function WorkerRow({
  worker,
  task,
  isSelected,
}: {
  worker: SwarmWorker;
  task?: SwarmTask;
  isSelected: boolean;
}) {
  const statusIcons: Record<string, string> = {
    idle: '⏸',
    working: '⚡',
    waiting: '⏳',
    completed: '✓',
    failed: '✗',
  };

  const statusColors: Record<string, string> = {
    idle: COLORS.textDim,
    working: COLORS.warning,
    waiting: COLORS.info,
    completed: COLORS.success,
    failed: COLORS.error,
  };

  return (
    <Box>
      <Text color={isSelected ? COLORS.primary : COLORS.textDim}>
        {isSelected ? '▸ ' : '  '}
      </Text>
      <Text color={statusColors[worker.status] || COLORS.textDim}>
        {statusIcons[worker.status] || '?'}
      </Text>
      <Text color={COLORS.text}> {worker.name.padEnd(10)}</Text>
      <Text color={COLORS.textDim}>
        {task ? task.description.slice(0, 35) : 'idle'}
      </Text>
    </Box>
  );
}

// Swarm launcher component (simpler - just starts and attaches)
export function SwarmLauncher({
  goal,
  accessToken,
  storeId,
  workerCount = 4,
  onExit,
}: SwarmViewProps) {
  const { exit } = useApp();
  const [status, setStatus] = useState<'starting' | 'attaching' | 'error'>('starting');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const launch = async () => {
      try {
        // Check tmux
        if (!isTmuxAvailable()) {
          throw new Error('tmux is required. Install with: brew install tmux');
        }

        // Start swarm
        const state = await startSwarm({
          goal,
          workerCount,
          workingDirectory: process.cwd(),
          accessToken,
          storeId,
        });

        setStatus('attaching');

        // Short delay then attach
        setTimeout(() => {
          attachSession(state.tmuxSession);
          exit();
        }, 1000);
      } catch (err: any) {
        setError(err.message);
        setStatus('error');
      }
    };

    launch();
  }, [goal, accessToken, storeId, workerCount, exit]);

  useInput((input, key) => {
    if (key.escape || (key.ctrl && input === 'c') || status === 'error') {
      onExit();
    }
  });

  if (status === 'error') {
    return (
      <Box flexDirection="column" padding={1}>
        <Text color={COLORS.error}>Error: {error}</Text>
        <Box marginTop={1}>
          <Text color={COLORS.textVeryDim}>Press any key to continue...</Text>
        </Box>
      </Box>
    );
  }

  return (
    <Box flexDirection="column" padding={1}>
      <Box marginBottom={1}>
        <Text bold color={COLORS.primary}>Swarm</Text>
      </Box>
      <Spinner label={status === 'starting' ? 'Initializing swarm...' : 'Attaching to tmux...'} />
      <Box marginTop={1}>
        <Text color={COLORS.textDim}>Goal: {goal}</Text>
      </Box>
    </Box>
  );
}
