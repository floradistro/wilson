import { useState, useEffect } from 'react';
import { Box, Text } from 'ink';

interface Todo {
  content: string;
  status: 'pending' | 'in_progress' | 'completed';
}

interface TodoListProps {
  todos: Todo[];
}

const SPINNER = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

export function TodoList({ todos }: TodoListProps) {
  const [frame, setFrame] = useState(0);

  // Animate spinner for in-progress items
  const hasInProgress = todos.some(t => t.status === 'in_progress');
  useEffect(() => {
    if (!hasInProgress) return;
    const timer = setInterval(() => setFrame(f => (f + 1) % SPINNER.length), 80);
    return () => clearInterval(timer);
  }, [hasInProgress]);

  if (!todos || todos.length === 0) return null;

  const completed = todos.filter(t => t.status === 'completed').length;
  const inProgress = todos.findIndex(t => t.status === 'in_progress');

  return (
    <Box flexDirection="column" marginY={1}>
      <Box marginBottom={1}>
        <Text bold color="white">Tasks</Text>
        <Text dimColor> ({completed}/{todos.length})</Text>
      </Box>
      {todos.map((todo, i) => {
        const isActive = todo.status === 'in_progress';
        let icon: string;
        let color: string;
        let textColor: string;

        switch (todo.status) {
          case 'completed':
            icon = '✓';
            color = '#7DC87D';
            textColor = '#666666';
            break;
          case 'in_progress':
            icon = SPINNER[frame];
            color = '#7DC87D';
            textColor = '#E0E0E0';
            break;
          default:
            icon = '○';
            color = '#555555';
            textColor = '#888888';
        }

        return (
          <Box key={`${i}-${todo.content.slice(0, 20)}`}>
            <Text color={color}>{icon}</Text>
            <Text color={textColor}> {todo.content}</Text>
            {isActive && <Text color="#7DC87D"> ←</Text>}
          </Box>
        );
      })}
    </Box>
  );
}
