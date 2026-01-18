import { useState, useCallback } from 'react';
import { Box, Text, useInput } from 'ink';

interface QuickAction {
  id: string;
  label: string;
  prompt: string;
  icon: string;
}

// Quick actions for Wilson CLI
const QUICK_ACTIONS: QuickAction[] = [
  { id: 'sales', label: 'Sales Today', prompt: 'Show me today\'s sales summary with charts', icon: '$' },
  { id: 'products', label: 'Find Products', prompt: 'Search products by name or category', icon: '#' },
  { id: 'inventory', label: 'Low Stock', prompt: 'Show products with low inventory', icon: '!' },
  { id: 'analytics', label: 'Analytics', prompt: 'Show me analytics dashboard with key metrics', icon: '%' },
  { id: 'orders', label: 'Recent Orders', prompt: 'Show recent orders from today', icon: '@' },
  { id: 'top', label: 'Top Sellers', prompt: 'What are the top selling products this week?', icon: '*' },
];

interface QuickMenuProps {
  onSelect: (prompt: string) => void;
  onCancel: () => void;
}

export function QuickMenu({ onSelect, onCancel }: QuickMenuProps) {
  const [selectedIndex, setSelectedIndex] = useState(0);

  useInput(useCallback((input: string, key: { upArrow?: boolean; downArrow?: boolean; return?: boolean; escape?: boolean }) => {
    if (key.escape) {
      onCancel();
      return;
    }

    if (key.return) {
      onSelect(QUICK_ACTIONS[selectedIndex].prompt);
      return;
    }

    if (key.upArrow) {
      setSelectedIndex(prev => (prev - 1 + QUICK_ACTIONS.length) % QUICK_ACTIONS.length);
      return;
    }

    if (key.downArrow) {
      setSelectedIndex(prev => (prev + 1) % QUICK_ACTIONS.length);
      return;
    }

    // Number keys for quick select
    const num = parseInt(input);
    if (num >= 1 && num <= QUICK_ACTIONS.length) {
      onSelect(QUICK_ACTIONS[num - 1].prompt);
    }
  }, [selectedIndex, onSelect, onCancel]));

  return (
    <Box flexDirection="column" paddingX={1}>
      <Box marginBottom={1}>
        <Text bold color="green">Quick Actions</Text>
        <Text dimColor> (↑↓ to navigate, Enter to select, Esc to cancel)</Text>
      </Box>

      {QUICK_ACTIONS.map((action, index) => (
        <Box key={action.id}>
          <Text color={index === selectedIndex ? 'green' : 'gray'}>
            {index === selectedIndex ? '>' : ' '}
          </Text>
          <Text color={index === selectedIndex ? 'green' : 'white'}>
            {' '}{index + 1}. {action.icon} {action.label}
          </Text>
          {index === selectedIndex && (
            <Text dimColor> - {action.prompt.slice(0, 40)}...</Text>
          )}
        </Box>
      ))}

      <Box marginTop={1}>
        <Text dimColor>Type a number (1-{QUICK_ACTIONS.length}) or press Enter</Text>
      </Box>
    </Box>
  );
}
