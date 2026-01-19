/**
 * Centralized color theme for Wilson CLI
 * Material Ocean inspired - high contrast, diverse syntax colors
 */

export const COLORS = {
  // === Primary Brand ===
  primary: '#7DC87D',      // Wilson green
  secondary: '#89DDFF',    // Cyan accent

  // === Status Colors ===
  success: '#C3E88D',      // Bright green
  error: '#FF5370',        // Bright red
  warning: '#FFCB6B',      // Amber
  info: '#82AAFF',         // Blue

  // === Text Colors (higher contrast) ===
  text: '#EEFFFF',         // Primary text - brighter
  textMuted: '#A0A0A0',    // Secondary text
  textDim: '#707070',      // Tertiary
  textVeryDim: '#505050',  // Subtle
  textDisabled: '#404040', // Disabled

  // === UI Elements ===
  border: '#3D4D5D',       // Subtle blue-gray
  borderLight: '#2D3D4D',

  // === Syntax Highlighting (Material Ocean - full spectrum) ===
  syntax: {
    keyword: '#C792EA',    // Purple - if, const, function, return, import
    builtin: '#82AAFF',    // Blue - console, require, process
    type: '#FFCB6B',       // Yellow - types, interfaces, classes
    literal: '#FF5370',    // Red - true, false, null, undefined
    number: '#F78C6C',     // Orange - numbers
    string: '#C3E88D',     // Green - strings
    comment: '#546E7A',    // Gray - comments
    function: '#82AAFF',   // Blue - function calls
    operator: '#89DDFF',   // Cyan - = + - => ? :
    property: '#F07178',   // Coral - object.property
    tag: '#F07178',        // Coral - <div>, <Component>
    attribute: '#C792EA',  // Purple - className=, onClick=
    variable: '#EEFFFF',   // White - variables
    punctuation: '#89DDFF', // Cyan - {} [] () , ;
    regexp: '#89DDFF',     // Cyan - /regex/
    selector: '#FF5370',   // Red - CSS selectors
    class: '#FFCB6B',      // Yellow - class names
  },

  // === Diff Colors ===
  diff: {
    add: '#C3E88D',        // Green
    remove: '#FF5370',     // Red
    context: '#546E7A',    // Comment gray
  },
} as const;

// Type exports
export type ColorKey = keyof typeof COLORS;
export type SyntaxColorKey = keyof typeof COLORS.syntax;
export type DiffColorKey = keyof typeof COLORS.diff;
