import React, { useState } from 'react';
import { Box, Text } from 'ink';
import { COLORS } from '../theme/colors.js';
import { ICONS, SPACING } from '../theme/ui.js';
import { DESIGN_SYSTEM } from '../theme/design-system.js';

interface HelpItem {
  command: string;
  description: string;
  example?: string;
  category: 'basic' | 'file' | 'search' | 'system' | 'advanced';
  shortcut?: string;
}

const HELP_ITEMS: HelpItem[] = [
  // Basic commands
  { command: '/help', description: 'Show this help menu', category: 'basic', shortcut: '?' },
  { command: '/clear', description: 'Clear chat history', category: 'basic', shortcut: 'Ctrl+L' },
  { command: '/status', description: 'Show system status', category: 'basic' },
  { command: '/stores', description: 'Switch store context', category: 'basic' },
  { command: '/location', description: 'Change location', category: 'basic' },
  
  // File operations
  { command: 'Read <file>', description: 'Read file contents', example: 'Read src/App.tsx', category: 'file' },
  { command: 'Write <file>', description: 'Write to file', example: 'Write package.json', category: 'file' },
  { command: 'Edit <file>', description: 'Edit file content', example: 'Edit README.md', category: 'file' },
  { command: 'LS <path>', description: 'List directory contents', example: 'LS src/', category: 'file' },
  { command: 'Bash <cmd>', description: 'Run shell command', example: 'Bash npm install', category: 'file' },
  
  // Search operations
  { command: 'Glob <pattern>', description: 'Find files by pattern', example: 'Glob **/*.ts', category: 'search' },
  { command: 'Grep <pattern>', description: 'Search file contents', example: 'Grep "function"', category: 'search' },
  { command: 'Search <query>', description: 'Semantic code search', example: 'Search "authentication logic"', category: 'search' },
  
  // System
  { command: 'Index', description: 'Build search index', category: 'system' },
  { command: 'Env', description: 'Setup environment', category: 'system' },
  
  // Advanced
  { command: 'Symbol <name>', description: 'Find symbol definition', example: 'Symbol UserComponent', category: 'advanced' },
  { command: 'Fetch <url>', description: 'Make HTTP request', example: 'Fetch https://api.example.com', category: 'advanced' },
];

interface ContextualHelpProps {
  currentInput?: string;
  compact?: boolean;
  maxItems?: number;
  showCategories?: boolean;
}

export function ContextualHelp({ 
  currentInput = '',
  compact = false,
  maxItems = 15,
  showCategories = true 
}: ContextualHelpProps) {
  const [selectedCategory, setSelectedCategory] = useState<string>('all');

  // Filter help items based on current input
  const getRelevantItems = () => {
    let items = HELP_ITEMS;

    // Filter by input relevance
    if (currentInput.length > 0) {
      const input = currentInput.toLowerCase();
      items = items.filter(item => 
        item.command.toLowerCase().includes(input) ||
        item.description.toLowerCase().includes(input) ||
        item.example?.toLowerCase().includes(input)
      );
    }

    // Filter by selected category
    if (selectedCategory !== 'all') {
      items = items.filter(item => item.category === selectedCategory);
    }

    // Sort by relevance and limit
    return items
      .sort((a, b) => {
        // Prioritize exact matches
        if (currentInput) {
          const aExact = a.command.toLowerCase().startsWith(currentInput.toLowerCase());
          const bExact = b.command.toLowerCase().startsWith(currentInput.toLowerCase());
          if (aExact && !bExact) return -1;
          if (!aExact && bExact) return 1;
        }
        return 0;
      })
      .slice(0, maxItems);
  };

  const relevantItems = getRelevantItems();
  const categories = ['all', 'basic', 'file', 'search', 'system', 'advanced'];

  const getCategoryIcon = (category: string) => {
    const icons = {
      all: ICONS.wilson,
      basic: ICONS.info,
      file: ICONS.file,
      search: ICONS.grep,
      system: ICONS.task,
      advanced: ICONS.api,
    };
    return icons[category as keyof typeof icons] || ICONS.bullet;
  };

  const getCategoryColor = (category: string) => {
    return category === selectedCategory ? COLORS.primary : COLORS.textMuted;
  };

  if (compact) {
    return (
      <Box flexDirection="column">
        <Box marginBottom={1}>
          <Text color={COLORS.textMuted}>
            💡 Quick help:
          </Text>
        </Box>
        {relevantItems.slice(0, 5).map((item, index) => (
          <Box key={item.command}>
            <Text color={COLORS.primary}>
              {item.command}
            </Text>
            <Text color={COLORS.textMuted} marginLeft={2}>
              - {item.description}
            </Text>
          </Box>
        ))}
        {relevantItems.length > 5 && (
          <Box marginTop={1}>
            <Text color={COLORS.textDim}>
              ...and {relevantItems.length - 5} more. Type /help for full list.
            </Text>
          </Box>
        )}
      </Box>
    );
  }

  return (
    <Box flexDirection="column">
      {/* Header */}
      <Box marginBottom={2}>
        <Text color={COLORS.primary} bold>
          {ICONS.wilson} Wilson Help
        </Text>
        {currentInput && (
          <Text color={COLORS.textMuted} marginLeft={2}>
            - Results for "{currentInput}"
          </Text>
        )}
      </Box>

      {/* Category filters */}
      {showCategories && (
        <Box marginBottom={2}>
          <Text color={COLORS.textMuted} marginRight={2}>
            Categories:
          </Text>
          {categories.map((category, index) => (
            <Box key={category} marginRight={2}>
              <Text 
                color={getCategoryColor(category)}
                dimColor={category !== selectedCategory}
              >
                {getCategoryIcon(category)} {category}
              </Text>
            </Box>
          ))}
        </Box>
      )}

      {/* Help items */}
      {relevantItems.length === 0 ? (
        <Box>
          <Text color={COLORS.textMuted}>
            No help items found for "{currentInput}". Try a different search term.
          </Text>
        </Box>
      ) : (
        <Box flexDirection="column">
          {relevantItems.map((item, index) => (
            <Box key={item.command} marginBottom={1} flexDirection="column">
              <Box>
                <Text color={COLORS.primary} bold>
                  {item.command}
                </Text>
                {item.shortcut && (
                  <Text color={COLORS.textDim} marginLeft={2}>
                    ({item.shortcut})
                  </Text>
                )}
              </Box>
              <Box marginLeft={2}>
                <Text color={COLORS.textMuted}>
                  {item.description}
                </Text>
              </Box>
              {item.example && (
                <Box marginLeft={4} marginTop={0}>
                  <Text color={COLORS.textDim}>
                    Example: {item.example}
                  </Text>
                </Box>
              )}
            </Box>
          ))}
        </Box>
      )}

      {/* Footer tips */}
      <Box marginTop={2} flexDirection="column">
        <Text color={COLORS.textDim}>
          Tips:
        </Text>
        <Text color={COLORS.textVeryDim}>
          • Commands are case-sensitive: use exact capitalization
        </Text>
        <Text color={COLORS.textVeryDim}>
          • Use Tab for autocompletion where available
        </Text>
        <Text color={COLORS.textVeryDim}>
          • Press Escape to cancel current operation
        </Text>
        <Text color={COLORS.textVeryDim}>
          • Use Ctrl+C to exit Wilson
        </Text>
      </Box>
    </Box>
  );
}

/**
 * Contextual tips that appear based on current state
 */
export function SmartTips({ 
  context,
  tips 
}: { 
  context: 'first_run' | 'error' | 'success' | 'idle';
  tips?: string[];
}) {
  const contextTips = {
    first_run: [
      'Welcome to Wilson! Try typing "help me get started"',
      'Use /stores to select your store context',
      'Ask questions like "show me today\'s sales" or "what products are low on stock"'
    ],
    error: [
      'Something went wrong. Try rephrasing your request',
      'Check your network connection with /status',
      'Use /clear to start fresh'
    ],
    success: [
      'Great! What would you like to do next?',
      'Try exploring with commands like "show inventory" or "create a product"',
      'Use /help to see all available commands'
    ],
    idle: [
      'Need help? Type /help or ask a question',
      'Try "analyze sales trends" or "show top products"',
      'Use Tab for command completion'
    ]
  };

  const displayTips = tips || contextTips[context];

  return (
    <Box flexDirection="column" marginY={1}>
      {displayTips.map((tip, index) => (
        <Box key={index} marginBottom={index === displayTips.length - 1 ? 0 : 1}>
          <Text color={COLORS.textDim}>
            {ICONS.bullet} {tip}
          </Text>
        </Box>
      ))}
    </Box>
  );
}