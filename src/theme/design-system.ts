/**
 * Apple-level Design System for Wilson CLI
 * Defines spacing, typography, and semantic design tokens
 */

export const DESIGN_SYSTEM = {
  // === Spacing Scale (Apple's 4pt grid) ===
  spacing: {
    xs: 0.5,   // 2px
    sm: 1,     // 4px
    md: 2,     // 8px
    lg: 3,     // 12px
    xl: 4,     // 16px
    xxl: 6,    // 24px
    xxxl: 8,   // 32px
  },

  // === Typography Scale ===
  typography: {
    // Headlines
    h1: { weight: 'bold', size: 'large' },
    h2: { weight: 'bold', size: 'normal' },
    h3: { weight: 'normal', size: 'normal' },
    
    // Body text
    body: { weight: 'normal', size: 'normal' },
    caption: { weight: 'normal', size: 'small' },
    
    // Code
    code: { weight: 'normal', size: 'normal' },
    mono: { weight: 'normal', size: 'normal' },
    
    // Interactive
    button: { weight: 'normal', size: 'normal' },
    link: { weight: 'normal', size: 'normal' },
  },

  // === Semantic Tokens ===
  semantic: {
    // Surfaces
    surface: {
      primary: '#0B1426',     // Main background
      secondary: '#1A2332',   // Cards, panels
      tertiary: '#243040',    // Elevated surfaces
      overlay: '#2A3441',     // Modals, overlays
    },
    
    // Borders
    border: {
      subtle: '#3D4D5D',      // Light borders
      default: '#4A5A6D',     // Standard borders
      strong: '#5A6A7D',      // Emphasized borders
      focused: '#7DC87D',     // Focus states
    },
    
    // Interactive states
    interactive: {
      default: '#EEFFFF',
      hover: '#7DC87D',
      active: '#6AB86A',
      disabled: '#505050',
      focus: '#89DDFF',
    },
    
    // Content hierarchy
    content: {
      primary: '#EEFFFF',     // Main content
      secondary: '#B0B8C0',   // Supporting content
      tertiary: '#8090A0',    // Subtle content
      inverse: '#0B1426',     // Text on light backgrounds
    },
  },

  // === Animation Timings ===
  animation: {
    // Duration (in ms for setTimeout, but conceptual for terminal)
    instant: 0,
    fast: 150,
    normal: 250,
    slow: 400,
    
    // Easing (for conceptual timing)
    easing: {
      default: 'ease-out',
      sharp: 'ease-in',
      smooth: 'ease-in-out',
    },
  },

  // === Layout ===
  layout: {
    // Maximum content width
    maxWidth: {
      sm: 60,   // Small content
      md: 80,   // Default content
      lg: 120,  // Wide content
      xl: 160,  // Full width
    },
    
    // Breakpoints (terminal columns)
    breakpoints: {
      sm: 60,
      md: 80,
      lg: 120,
      xl: 160,
    },
  },

  // === Iconography ===
  icons: {
    // Status
    success: '✓',
    error: '✗',
    warning: '⚠',
    info: 'ℹ',
    
    // Actions
    search: '🔍',
    settings: '⚙',
    help: '?',
    back: '←',
    forward: '→',
    up: '↑',
    down: '↓',
    
    // Content
    file: '📄',
    folder: '📁',
    link: '🔗',
    code: '💻',
    data: '📊',
    
    // Loading
    spinner: ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'],
    
    // Bullets
    bullet: '•',
    arrow: '→',
    chevron: '›',
  },
} as const;

// === Helper Functions ===

/**
 * Get responsive spacing based on terminal width
 */
export function getResponsiveSpacing(terminalWidth: number, baseSpacing: number): number {
  if (terminalWidth < 60) return Math.max(1, baseSpacing - 1);
  if (terminalWidth < 120) return baseSpacing;
  return baseSpacing + 1;
}

/**
 * Get semantic color for content hierarchy
 */
export function getContentColor(level: 'primary' | 'secondary' | 'tertiary' = 'primary'): string {
  return DESIGN_SYSTEM.semantic.content[level];
}

/**
 * Get spacing value
 */
export function spacing(size: keyof typeof DESIGN_SYSTEM.spacing): number {
  return DESIGN_SYSTEM.spacing[size];
}

/**
 * Get maximum width for content
 */
export function getMaxWidth(size: keyof typeof DESIGN_SYSTEM.layout.maxWidth = 'md'): number {
  return DESIGN_SYSTEM.layout.maxWidth[size];
}