/**
 * UI Constants for Apple-level polish
 * Consistent icons, spacing, and visual hierarchy
 */

// === Status Icons - Semantic and Beautiful ===
export const ICONS = {
  // Status indicators - refined for clarity
  success: '●',       // Filled circle - completion
  error: '●',         // Filled circle - error (red)
  warning: '●',       // Filled circle - warning (amber)
  info: '●',          // Filled circle - info (blue)
  running: '●',       // Animated dot for progress
  pending: '○',       // Empty circle for pending
  
  // Subtle progress indicators
  progressDot: '●',
  progressEmpty: '○',
  progressCurrent: '◐',

  // Tool-specific icons - more refined
  read: '◇',         // Diamond for read operations
  write: '◆',        // Filled diamond for write
  edit: '◈',         // Diamond with dot for edit
  bash: '▸',         // Play arrow for commands
  sql: '⊡',          // Boxed for database
  glob: '◎',         // Target for search
  grep: '⊙',         // Circled dot for content search
  task: '▪',         // Small square for tasks
  api: '⟡',          // Hexagon for API calls
  file: '◻',         // Square for files
  folder: '◼',       // Filled square for folders

  // Navigation - Apple-style
  prompt: '›',        // Chevron for prompt (cleaner than ❯)
  arrow: '→',         // Direction indicator
  back: '←',          // Back navigation
  up: '↑',           // Up direction
  down: '↓',         // Down direction
  bullet: '•',       // List item
  chevron: '›',      // Menu chevron
  
  // Interactive states
  selected: '●',     // Selected item
  unselected: '○',   // Unselected item
  focused: '▸',      // Focused item
  
  // Hierarchy
  level1: '▸',       // Top level
  level2: '  ▪',     // Second level
  level3: '    ‣',   // Third level

  // Box drawing - rounded for modern look
  boxTop: '╭',
  boxBottom: '╰',
  boxVert: '│',
  boxHoriz: '─',
  boxCornerTR: '╮',
  boxCornerBR: '╯',
  
  // Connection lines
  connect: '├',
  connectLast: '└',
  pipe: '│',

  // Special characters
  ellipsis: '…',
  checkmark: '✓',
  cross: '✗',
  question: '?',
  
  // Loading states
  spinner: {
    frames: ['●∘∘', '∘●∘', '∘∘●', '∘●∘'],
    interval: 200,
  },
  
  // Brands (subtle)
  wilson: '◉',       // Wilson logo placeholder
  
} as const;

// === Animation System - Apple-inspired ===
export const ANIMATION = {
  // Spinner variants for different contexts
  spinners: {
    // Default spinner - dots
    dots: {
      frames: ['●∘∘', '∘●∘', '∘∘●', '∘●∘'],
      interval: 250,
    },
    // Fast spinner - for quick operations
    fast: {
      frames: ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'],
      interval: 120,
    },
    // Pulsing dot - for waiting states
    pulse: {
      frames: ['●', '◐', '○', '◑'],
      interval: 300,
    },
  },
  
  // Timing constants
  timing: {
    instant: 0,
    fast: 150,
    normal: 250,
    slow: 400,
  },
} as const;

// Knight Rider style animation - bouncing dot (primary spinner)
export const KNIGHT_RIDER_FRAMES = ['●∘∘∘∘', '∘●∘∘∘', '∘∘●∘∘', '∘∘∘●∘', '∘∘∘∘●', '∘∘∘●∘', '∘∘●∘∘', '∘●∘∘∘'];
export const KNIGHT_RIDER_INTERVAL = 100;

// Legacy exports for backward compatibility (now using Knight Rider)
export const SPINNER_FRAMES = KNIGHT_RIDER_FRAMES;
export const SPINNER_INTERVAL = KNIGHT_RIDER_INTERVAL;

// === Spacing System - Apple's 4pt Grid Adapted ===
export const SPACING = {
  // Core spacing scale
  xs: 0.5,          // Micro spacing
  sm: 1,            // Small spacing
  md: 2,            // Default spacing
  lg: 3,            // Large spacing
  xl: 4,            // Extra large
  xxl: 6,           // Section spacing
  
  // Semantic spacing
  indent: 2,        // Standard indent level
  toolGap: 2,       // Gap between tools
  sectionGap: 3,    // Gap between major sections
  blockGap: 1,      // Gap before/after code blocks
  lineNumWidth: 4,  // Width for line numbers
  headerGap: 1,     // Gap after header
  promptGap: 1,     // Gap around prompt
  
  // Layout spacing
  marginHorizontal: 2,  // Side margins
  marginVertical: 1,    // Top/bottom margins
  paddingDefault: 1,    // Default padding
  
  // Interactive spacing
  buttonPadding: 1,     // Button internal padding
  inputPadding: 1,      // Input field padding
  menuItemPadding: 1,   // Menu item padding
} as const;

// Typography weights (via chalk)
export const WEIGHT = {
  normal: false,
  bold: true,
  dim: 'dim',
} as const;

// Tool display configurations
export const TOOL_CONFIG: Record<string, {
  icon: string;
  label: string;
  showDuration: boolean;
}> = {
  read: { icon: ICONS.read, label: 'READ', showDuration: false },
  edit: { icon: ICONS.edit, label: 'EDIT', showDuration: true },
  write: { icon: ICONS.write, label: 'WRITE', showDuration: true },
  bash: { icon: ICONS.bash, label: 'RUN', showDuration: true },
  glob: { icon: ICONS.glob, label: 'FIND', showDuration: false },
  grep: { icon: ICONS.grep, label: 'SEARCH', showDuration: false },
  ls: { icon: ICONS.glob, label: 'LIST', showDuration: false },
  todowrite: { icon: ICONS.task, label: 'TASKS', showDuration: false },
  task: { icon: ICONS.task, label: 'AGENT', showDuration: true },
  webfetch: { icon: ICONS.arrow, label: 'FETCH', showDuration: true },
  websearch: { icon: ICONS.glob, label: 'WEB', showDuration: true },
};

// Maximum widths for various elements
export const MAX_WIDTH = {
  sublabel: 50,     // Max width for tool sublabels
  preview: 80,      // Max width for code previews
  error: 100,       // Max width for error messages
  path: 45,         // Max width for file paths
} as const;
