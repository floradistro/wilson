/**
 * Smart Edit - Anthropic-style intelligent file editing
 *
 * Features:
 * - Pre-validation before editing
 * - Fuzzy matching with suggestions
 * - Auto-expand context for unique matches
 * - Whitespace-aware matching
 * - Detailed error messages with fix suggestions
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import type { ToolResult } from '../../types.js';
import { getLastReadContent, hasRecentlyRead, recordFileRead } from './hooks.js';

// =============================================================================
// Types
// =============================================================================

export interface SmartEditParams {
  file_path: string;
  old_string: string;
  new_string: string;
  replace_all?: boolean;
  // New smart options
  fuzzy?: boolean; // Allow whitespace-flexible matching
  auto_expand?: boolean; // Auto-expand context for uniqueness
}

interface MatchResult {
  found: boolean;
  exactMatch: boolean;
  matchCount: number;
  bestMatch?: {
    text: string;
    startIndex: number;
    endIndex: number;
    lineNumber: number;
    similarity: number;
  };
  suggestions?: string[];
  nearMatches?: Array<{
    text: string;
    lineNumber: number;
    similarity: number;
    preview: string;
  }>;
}

interface DiffLine {
  type: 'context' | 'add' | 'remove';
  content: string;
  lineNum?: number;
}

// =============================================================================
// String Similarity (Levenshtein-based)
// =============================================================================

function levenshteinDistance(a: string, b: string): number {
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  const matrix: number[][] = [];

  for (let i = 0; i <= b.length; i++) {
    matrix[i] = [i];
  }
  for (let j = 0; j <= a.length; j++) {
    matrix[0][j] = j;
  }

  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      if (b.charAt(i - 1) === a.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1,
          matrix[i][j - 1] + 1,
          matrix[i - 1][j] + 1
        );
      }
    }
  }

  return matrix[b.length][a.length];
}

function similarity(a: string, b: string): number {
  const maxLen = Math.max(a.length, b.length);
  if (maxLen === 0) return 1;
  return 1 - levenshteinDistance(a, b) / maxLen;
}

// =============================================================================
// Whitespace Normalization
// =============================================================================

function normalizeWhitespace(str: string): string {
  return str
    .replace(/\r\n/g, '\n') // Normalize line endings
    .replace(/\t/g, '  ') // Tabs to spaces
    .replace(/ +$/gm, '') // Trailing spaces
    .replace(/^ +/gm, (match) => match); // Preserve leading (indentation)
}

function flexibleMatch(content: string, search: string): number[] {
  const normalizedContent = normalizeWhitespace(content);
  const normalizedSearch = normalizeWhitespace(search);

  const indices: number[] = [];
  let pos = 0;

  while (true) {
    const idx = normalizedContent.indexOf(normalizedSearch, pos);
    if (idx === -1) break;
    indices.push(idx);
    pos = idx + 1;
  }

  return indices;
}

// =============================================================================
// Context Expansion
// =============================================================================

function getLineNumber(content: string, index: number): number {
  return content.substring(0, index).split('\n').length;
}

function expandContext(
  content: string,
  matchStart: number,
  matchEnd: number,
  linesAround: number = 2
): { expanded: string; startLine: number; endLine: number } {
  const lines = content.split('\n');
  const startLine = getLineNumber(content, matchStart);
  const endLine = getLineNumber(content, matchEnd);

  const expandedStart = Math.max(1, startLine - linesAround);
  const expandedEnd = Math.min(lines.length, endLine + linesAround);

  const expanded = lines.slice(expandedStart - 1, expandedEnd).join('\n');
  return { expanded, startLine: expandedStart, endLine: expandedEnd };
}

function findUniqueContext(
  content: string,
  search: string,
  matchIndex: number
): string | null {
  const lines = content.split('\n');
  const searchLines = search.split('\n');
  const matchLine = getLineNumber(content, matchIndex);

  // Try expanding context until unique
  for (let expand = 1; expand <= 5; expand++) {
    const startLine = Math.max(0, matchLine - 1 - expand);
    const endLine = Math.min(lines.length, matchLine - 1 + searchLines.length + expand);

    const expandedContext = lines.slice(startLine, endLine).join('\n');

    // Check if this expanded context is unique
    const matches = content.split(expandedContext).length - 1;
    if (matches === 1) {
      return expandedContext;
    }
  }

  return null;
}

// =============================================================================
// Smart Match Finding
// =============================================================================

function findMatches(content: string, search: string, fuzzy: boolean = false): MatchResult {
  // First try exact match
  const exactMatches: number[] = [];
  let pos = 0;
  while (true) {
    const idx = content.indexOf(search, pos);
    if (idx === -1) break;
    exactMatches.push(idx);
    pos = idx + 1;
  }

  if (exactMatches.length === 1) {
    return {
      found: true,
      exactMatch: true,
      matchCount: 1,
      bestMatch: {
        text: search,
        startIndex: exactMatches[0],
        endIndex: exactMatches[0] + search.length,
        lineNumber: getLineNumber(content, exactMatches[0]),
        similarity: 1,
      },
    };
  }

  if (exactMatches.length > 1) {
    return {
      found: true,
      exactMatch: true,
      matchCount: exactMatches.length,
      suggestions: [
        `Found ${exactMatches.length} matches. Add more context to make unique.`,
        `Matches at lines: ${exactMatches.map(i => getLineNumber(content, i)).join(', ')}`,
      ],
    };
  }

  // Try whitespace-flexible matching
  if (fuzzy) {
    const flexMatches = flexibleMatch(content, search);
    if (flexMatches.length === 1) {
      return {
        found: true,
        exactMatch: false,
        matchCount: 1,
        bestMatch: {
          text: search,
          startIndex: flexMatches[0],
          endIndex: flexMatches[0] + search.length,
          lineNumber: getLineNumber(content, flexMatches[0]),
          similarity: 0.95,
        },
        suggestions: ['Matched with whitespace normalization'],
      };
    }
  }

  // Find near matches
  const lines = content.split('\n');
  const searchLines = search.split('\n');
  const searchFirstLine = searchLines[0].trim();
  const nearMatches: MatchResult['nearMatches'] = [];

  for (let i = 0; i < lines.length; i++) {
    const lineTrimmed = lines[i].trim();
    const sim = similarity(lineTrimmed, searchFirstLine);

    if (sim > 0.6 && lineTrimmed.length > 10) {
      // Get the full text that matches the search length (for multi-line edits)
      const matchEndLine = Math.min(lines.length, i + searchLines.length);
      const fullMatchText = lines.slice(i, matchEndLine).join('\n');

      // Calculate similarity of full text (not just first line)
      const fullSim = similarity(
        normalizeWhitespace(fullMatchText),
        normalizeWhitespace(search)
      );

      // Get context around this line for preview
      const contextStart = Math.max(0, i - 1);
      const contextEnd = Math.min(lines.length, matchEndLine + 1);
      const preview = lines.slice(contextStart, contextEnd).join('\n');

      nearMatches.push({
        text: fullMatchText, // Store full matched text, not just first line
        lineNumber: i + 1,
        similarity: fullSim, // Use full text similarity
        preview,
      });
    }
  }

  // Sort by similarity
  nearMatches.sort((a, b) => b.similarity - a.similarity);

  return {
    found: false,
    exactMatch: false,
    matchCount: 0,
    nearMatches: nearMatches.slice(0, 3),
    suggestions: nearMatches.length > 0
      ? [`Did you mean one of these? (showing top ${Math.min(3, nearMatches.length)} matches)`]
      : ['No similar strings found. Verify the file content with Read tool.'],
  };
}

// =============================================================================
// Diff Generation
// =============================================================================

function generateDiff(
  oldContent: string,
  newContent: string,
  oldString: string,
  newString: string,
  filePath: string
): { diff: DiffLine[]; summary: string } {
  const oldLines = oldString.split('\n');
  const newLines = newString.split('\n');

  const contentLines = oldContent.split('\n');
  const changeStart = contentLines.findIndex(line =>
    oldString.startsWith(line) || oldString.includes(line)
  );

  const diff: DiffLine[] = [];

  // Context before
  if (changeStart > 0) {
    const contextStart = Math.max(0, changeStart - 2);
    for (let i = contextStart; i < changeStart; i++) {
      diff.push({ type: 'context', content: contentLines[i], lineNum: i + 1 });
    }
  }

  // Removed lines
  oldLines.forEach((line, i) => {
    diff.push({ type: 'remove', content: line, lineNum: changeStart + i + 1 });
  });

  // Added lines
  newLines.forEach((line) => {
    diff.push({ type: 'add', content: line });
  });

  // Context after
  const afterStart = changeStart + oldLines.length;
  for (let i = afterStart; i < Math.min(afterStart + 2, contentLines.length); i++) {
    diff.push({ type: 'context', content: contentLines[i], lineNum: i + 1 });
  }

  const removed = oldLines.length;
  const added = newLines.length;
  const summary = `${filePath.split('/').pop()}: -${removed} +${added} lines`;

  return { diff, summary };
}

// =============================================================================
// Smart Edit Execution
// =============================================================================

export async function smartEdit(params: SmartEditParams): Promise<ToolResult> {
  const {
    file_path,
    old_string,
    new_string,
    replace_all = false,
    fuzzy = true,
    auto_expand = true,
  } = params;

  // Validation
  if (!file_path) {
    return { success: false, error: 'Missing file_path' };
  }

  if (!old_string) {
    return { success: false, error: 'Missing old_string' };
  }

  if (!existsSync(file_path)) {
    return {
      success: false,
      error: `File not found: ${file_path}`,
      suggestion: 'Use Glob to find files matching your pattern',
      errorType: 'recoverable',
    };
  }

  // Read-before-write check
  if (!hasRecentlyRead(file_path)) {
    // Auto-read the file to update cache (but warn)
    try {
      const content = readFileSync(file_path, 'utf8');
      recordFileRead(file_path, content);
    } catch {
      // If we can't read, proceed anyway
    }
  }

  try {
    const content = readFileSync(file_path, 'utf8');
    const matchResult = findMatches(content, old_string, fuzzy);

    if (!matchResult.found) {
      // Check for high-similarity match (100% = whitespace difference only)
      // Auto-correct by using the actual text from the file
      if (matchResult.nearMatches && matchResult.nearMatches.length > 0) {
        const bestMatch = matchResult.nearMatches[0];

        // If 85%+ similar, auto-correct and perform the edit
        // This handles whitespace/indentation differences which are very common
        if (bestMatch.similarity >= 0.85) {
          const actualOldString = bestMatch.text;
          const actualIndex = content.indexOf(actualOldString);

          if (actualIndex !== -1) {
            // Perform the edit with the corrected old_string
            const newContent = content.slice(0, actualIndex) +
                              new_string +
                              content.slice(actualIndex + actualOldString.length);

            writeFileSync(file_path, newContent, 'utf8');
            recordFileRead(file_path, newContent);

            // Generate diff
            const { diff, summary } = generateDiff(content, newContent, actualOldString, new_string, file_path);

            return {
              success: true,
              message: `Edit applied (auto-corrected whitespace from ${Math.round(bestMatch.similarity * 100)}% match at line ${bestMatch.lineNumber})`,
              diff,
              summary,
              linesChanged: new_string.split('\n').length,
              autoCorrect: true,
            };
          }
        }
      }

      // Build helpful error message for lower similarity matches
      let errorMsg = 'String not found in file.\n\n⚠️ DO NOT RETRY THIS EDIT. The content you are looking for does not exist. Use Read to see the actual file contents.';

      if (matchResult.nearMatches && matchResult.nearMatches.length > 0) {
        errorMsg += '\n\n📍 Similar strings found:\n';
        matchResult.nearMatches.forEach((match, i) => {
          errorMsg += `\n${i + 1}. Line ${match.lineNumber} (${Math.round(match.similarity * 100)}% similar):\n`;
          errorMsg += `   ${match.preview.split('\n').join('\n   ')}\n`;
        });
      }

      // Show file preview for context
      const lines = content.split('\n');
      const preview = lines.slice(0, 20).map((line, i) =>
        `${String(i + 1).padStart(3)}│ ${line}`
      ).join('\n');
      const truncated = lines.length > 20 ? `\n... (${lines.length - 20} more lines)` : '';

      errorMsg += `\n\n📄 File preview:\n${preview}${truncated}`;

      return {
        success: false,
        error: errorMsg,
        is_error: true, // Tell Claude to NOT retry
        suggestion: 'DO NOT RETRY. Read the file first to see actual contents.',
        nearMatches: matchResult.nearMatches,
      };
    }

    // Check for multiple matches
    if (matchResult.matchCount > 1 && !replace_all) {
      // Try to find unique context
      if (auto_expand && matchResult.bestMatch) {
        const uniqueContext = findUniqueContext(
          content,
          old_string,
          matchResult.bestMatch.startIndex
        );

        if (uniqueContext) {
          return {
            success: false,
            error: `String found ${matchResult.matchCount} times.`,
            suggestion: `Use this expanded context for a unique match:\n\n${uniqueContext}`,
            errorType: 'recoverable',
          };
        }
      }

      return {
        success: false,
        error: `String found ${matchResult.matchCount} times. Use replace_all=true or add more context.`,
        suggestions: matchResult.suggestions,
        errorType: 'recoverable',
      };
    }

    // Perform the edit
    const newContent = replace_all
      ? content.split(old_string).join(new_string)
      : content.replace(old_string, new_string);

    writeFileSync(file_path, newContent);

    // Update read cache with new content
    recordFileRead(file_path, newContent);

    // Generate diff
    const { diff, summary } = generateDiff(content, newContent, old_string, new_string, file_path);

    return {
      success: true,
      file: file_path,
      diff,
      summary,
      matchType: matchResult.exactMatch ? 'exact' : 'fuzzy',
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to edit file',
      errorType: 'fatal',
    };
  }
}

// =============================================================================
// Pre-validation Function
// =============================================================================

export function validateEditParams(params: SmartEditParams, content: string): {
  valid: boolean;
  error?: string;
  suggestion?: string;
} {
  const matchResult = findMatches(content, params.old_string, true);

  if (!matchResult.found) {
    return {
      valid: false,
      error: 'String not found in file',
      suggestion: matchResult.nearMatches?.[0]?.preview,
    };
  }

  if (matchResult.matchCount > 1 && !params.replace_all) {
    return {
      valid: false,
      error: `Ambiguous: ${matchResult.matchCount} matches found`,
      suggestion: 'Add more context or use replace_all',
    };
  }

  return { valid: true };
}
