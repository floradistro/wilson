import { useState, useEffect, memo } from 'react';
import { Box, Text, useStdout } from 'ink';
import { COLORS } from '../theme/colors.js';
import { SPINNER_FRAMES } from '../theme/ui.js';

interface Todo {
  content: string;
  status: 'pending' | 'in_progress' | 'completed';
  activeForm?: string; // Present tense form for display during execution
}

interface TodoListProps {
  todos: Todo[];
}

export const TodoList = memo(function TodoList({ todos }: TodoListProps) {
  const [frame, setFrame] = useState(0);
  const { stdout } = useStdout();
  const termWidth = stdout?.columns || 80;

  // Animate spinner for in-progress items
  const hasInProgress = todos.some(t => t.status === 'in_progress');
  useEffect(() => {
    if (!hasInProgress) return;
    const timer = setInterval(() => setFrame(f => (f + 1) % SPINNER_FRAMES.length), 80);
    return () => clearInterval(timer);
  }, [hasInProgress]);

  if (!todos || todos.length === 0) return null;

  const completed = todos.filter(t => t.status === 'completed').length;
  const inProgressTodo = todos.find(t => t.status === 'in_progress');
  const pending = todos.filter(t => t.status === 'pending').length;

  // Claude Code style: Show current task prominently, collapse others
  // Only show: current task + count of remaining
  const maxTextWidth = Math.max(30, termWidth - 20);

  // Truncate text if needed
  const truncate = (text: string, max: number) => {
    if (text.length <= max) return text;
    return text.slice(0, max - 1) + '…';
  };

  return (
    <Box flexDirection="column">
      {/* Current task - prominent */}
      {inProgressTodo && (
        <Box>
          <Text color={COLORS.primary}>{SPINNER_FRAMES[frame]}</Text>
          <Text color={COLORS.text}> {truncate(inProgressTodo.activeForm || inProgressTodo.content, maxTextWidth)}</Text>
        </Box>
      )}

      {/* Summary line - compact */}
      <Box>
        <Text color={COLORS.textVeryDim}>
          {completed > 0 && `✓ ${completed} done`}
          {completed > 0 && pending > 0 && ' · '}
          {pending > 0 && `${pending} remaining`}
        </Text>
      </Box>
    </Box>
  );
});
