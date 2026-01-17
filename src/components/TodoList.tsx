import { Box, Text } from 'ink';

interface Todo {
  content: string;
  status: 'pending' | 'in_progress' | 'completed';
}

interface TodoListProps {
  todos: Todo[];
}

export function TodoList({ todos }: TodoListProps) {
  if (!todos || todos.length === 0) return null;

  const completed = todos.filter((t) => t.status === 'completed').length;

  return (
    <Box flexDirection="column" marginY={1}>
      <Box marginBottom={1}>
        <Text bold color="white">Tasks</Text>
        <Text dimColor> ({completed}/{todos.length})</Text>
      </Box>
      {todos.map((todo, i) => {
        let icon: string;
        let color: string;
        let textColor: string;

        switch (todo.status) {
          case 'completed':
            icon = '✓';
            color = 'green';
            textColor = 'gray';
            break;
          case 'in_progress':
            icon = '▸';
            color = 'blue';
            textColor = 'white';
            break;
          default:
            icon = '○';
            color = 'gray';
            textColor = 'white';
        }

        return (
          <Box key={i}>
            <Text color={color}>{icon}</Text>
            <Text color={textColor}> {todo.content}</Text>
          </Box>
        );
      })}
    </Box>
  );
}
