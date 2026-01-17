import { readFileSync } from 'fs';
import { extname, basename } from 'path';

export type SymbolKind =
  | 'function'
  | 'class'
  | 'interface'
  | 'type'
  | 'variable'
  | 'constant'
  | 'method'
  | 'property'
  | 'enum'
  | 'import'
  | 'export';

export interface Symbol {
  name: string;
  kind: SymbolKind;
  file: string;
  line: number;
  column: number;
  signature?: string;    // Full signature for functions/methods
  exported: boolean;
  parent?: string;       // Parent class/interface name
}

export interface SymbolIndex {
  symbols: Symbol[];
  byName: Map<string, Symbol[]>;
  byFile: Map<string, Symbol[]>;
  byKind: Map<SymbolKind, Symbol[]>;
}

// Language-specific extractors
type Extractor = (content: string, file: string) => Symbol[];

const extractors: Record<string, Extractor> = {
  typescript: extractTypeScript,
  javascript: extractTypeScript, // Same patterns work
  python: extractPython,
  go: extractGo,
  rust: extractRust,
};

function getLanguage(file: string): string | null {
  const ext = extname(file).toLowerCase();
  switch (ext) {
    case '.ts':
    case '.tsx':
      return 'typescript';
    case '.js':
    case '.jsx':
    case '.mjs':
    case '.cjs':
      return 'javascript';
    case '.py':
    case '.pyw':
      return 'python';
    case '.go':
      return 'go';
    case '.rs':
      return 'rust';
    default:
      return null;
  }
}

export function extractSymbols(file: string, content?: string): Symbol[] {
  const lang = getLanguage(file);
  if (!lang) return [];

  const extractor = extractors[lang];
  if (!extractor) return [];

  try {
    const code = content ?? readFileSync(file, 'utf8');
    return extractor(code, file);
  } catch {
    return [];
  }
}

// TypeScript/JavaScript extractor
function extractTypeScript(content: string, file: string): Symbol[] {
  const symbols: Symbol[] = [];
  const lines = content.split('\n');

  // Patterns for TypeScript/JavaScript
  const patterns = [
    // export function name(...) or export async function name(...)
    { regex: /^export\s+(async\s+)?function\s+(\w+)\s*\(/gm, kind: 'function' as SymbolKind, exported: true },
    // function name(...)
    { regex: /^(?:async\s+)?function\s+(\w+)\s*\(/gm, kind: 'function' as SymbolKind, exported: false, group: 1 },
    // const name = (...) => or const name = function
    { regex: /^(?:export\s+)?(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s+)?(?:\([^)]*\)|[\w,\s]+)\s*=>/gm, kind: 'function' as SymbolKind, exported: false },
    // export class Name
    { regex: /^export\s+(?:abstract\s+)?class\s+(\w+)/gm, kind: 'class' as SymbolKind, exported: true },
    // class Name
    { regex: /^(?:abstract\s+)?class\s+(\w+)/gm, kind: 'class' as SymbolKind, exported: false },
    // export interface Name
    { regex: /^export\s+interface\s+(\w+)/gm, kind: 'interface' as SymbolKind, exported: true },
    // interface Name
    { regex: /^interface\s+(\w+)/gm, kind: 'interface' as SymbolKind, exported: false },
    // export type Name
    { regex: /^export\s+type\s+(\w+)/gm, kind: 'type' as SymbolKind, exported: true },
    // type Name
    { regex: /^type\s+(\w+)/gm, kind: 'type' as SymbolKind, exported: false },
    // export enum Name
    { regex: /^export\s+enum\s+(\w+)/gm, kind: 'enum' as SymbolKind, exported: true },
    // enum Name
    { regex: /^enum\s+(\w+)/gm, kind: 'enum' as SymbolKind, exported: false },
    // export const/let/var Name (not functions)
    { regex: /^export\s+(?:const|let|var)\s+(\w+)\s*[=:][^=]/gm, kind: 'variable' as SymbolKind, exported: true },
  ];

  for (const { regex, kind, exported, group = 1 } of patterns) {
    let match;
    // Reset regex
    regex.lastIndex = 0;

    while ((match = regex.exec(content)) !== null) {
      const name = match[group] || match[1] || match[2];
      if (!name) continue;

      // Find line number
      const beforeMatch = content.substring(0, match.index);
      const line = beforeMatch.split('\n').length;

      // Get the full line for signature
      const lineContent = lines[line - 1]?.trim() || '';

      symbols.push({
        name,
        kind,
        file,
        line,
        column: match.index - beforeMatch.lastIndexOf('\n'),
        signature: lineContent.substring(0, 100),
        exported: exported || lineContent.startsWith('export'),
      });
    }
  }

  // Extract methods from classes
  const classPattern = /class\s+(\w+)[^{]*\{([^}]*(?:\{[^}]*\}[^}]*)*)\}/gs;
  let classMatch;
  while ((classMatch = classPattern.exec(content)) !== null) {
    const className = classMatch[1];
    const classBody = classMatch[2];

    // Method patterns
    const methodPattern = /(?:(?:public|private|protected|static|async|readonly)\s+)*(\w+)\s*\([^)]*\)\s*(?::\s*\w+)?\s*\{/g;
    let methodMatch;
    while ((methodMatch = methodPattern.exec(classBody)) !== null) {
      const methodName = methodMatch[1];
      if (methodName === 'constructor') continue;

      const beforeMethod = content.substring(0, classMatch.index) + classBody.substring(0, methodMatch.index);
      const line = beforeMethod.split('\n').length;

      symbols.push({
        name: methodName,
        kind: 'method',
        file,
        line,
        column: 0,
        parent: className,
        exported: false,
      });
    }
  }

  return symbols;
}

// Python extractor
function extractPython(content: string, file: string): Symbol[] {
  const symbols: Symbol[] = [];
  const lines = content.split('\n');

  const patterns = [
    // def function_name(...)
    { regex: /^def\s+(\w+)\s*\(/gm, kind: 'function' as SymbolKind },
    // async def function_name(...)
    { regex: /^async\s+def\s+(\w+)\s*\(/gm, kind: 'function' as SymbolKind },
    // class ClassName
    { regex: /^class\s+(\w+)/gm, kind: 'class' as SymbolKind },
    // CONSTANT = ... (all caps at module level)
    { regex: /^([A-Z][A-Z0-9_]+)\s*=/gm, kind: 'constant' as SymbolKind },
  ];

  for (const { regex, kind } of patterns) {
    let match;
    regex.lastIndex = 0;

    while ((match = regex.exec(content)) !== null) {
      const name = match[1];
      const beforeMatch = content.substring(0, match.index);
      const line = beforeMatch.split('\n').length;
      const lineContent = lines[line - 1]?.trim() || '';

      symbols.push({
        name,
        kind,
        file,
        line,
        column: 0,
        signature: lineContent.substring(0, 100),
        exported: !name.startsWith('_'),
      });
    }
  }

  return symbols;
}

// Go extractor
function extractGo(content: string, file: string): Symbol[] {
  const symbols: Symbol[] = [];
  const lines = content.split('\n');

  const patterns = [
    // func Name(...)
    { regex: /^func\s+(\w+)\s*\(/gm, kind: 'function' as SymbolKind },
    // func (r *Receiver) Name(...)
    { regex: /^func\s+\([^)]+\)\s+(\w+)\s*\(/gm, kind: 'method' as SymbolKind },
    // type Name struct
    { regex: /^type\s+(\w+)\s+struct/gm, kind: 'class' as SymbolKind },
    // type Name interface
    { regex: /^type\s+(\w+)\s+interface/gm, kind: 'interface' as SymbolKind },
    // type Name = or type Name ...
    { regex: /^type\s+(\w+)\s+(?!=struct|interface)/gm, kind: 'type' as SymbolKind },
    // const Name or var Name
    { regex: /^(?:const|var)\s+(\w+)/gm, kind: 'variable' as SymbolKind },
  ];

  for (const { regex, kind } of patterns) {
    let match;
    regex.lastIndex = 0;

    while ((match = regex.exec(content)) !== null) {
      const name = match[1];
      const beforeMatch = content.substring(0, match.index);
      const line = beforeMatch.split('\n').length;
      const lineContent = lines[line - 1]?.trim() || '';

      symbols.push({
        name,
        kind,
        file,
        line,
        column: 0,
        signature: lineContent.substring(0, 100),
        // Go exports based on capitalization
        exported: name[0] === name[0].toUpperCase(),
      });
    }
  }

  return symbols;
}

// Rust extractor
function extractRust(content: string, file: string): Symbol[] {
  const symbols: Symbol[] = [];
  const lines = content.split('\n');

  const patterns = [
    // pub fn name or fn name
    { regex: /^(?:pub\s+)?(?:async\s+)?fn\s+(\w+)/gm, kind: 'function' as SymbolKind },
    // pub struct Name or struct Name
    { regex: /^(?:pub\s+)?struct\s+(\w+)/gm, kind: 'class' as SymbolKind },
    // pub enum Name or enum Name
    { regex: /^(?:pub\s+)?enum\s+(\w+)/gm, kind: 'enum' as SymbolKind },
    // pub trait Name or trait Name
    { regex: /^(?:pub\s+)?trait\s+(\w+)/gm, kind: 'interface' as SymbolKind },
    // type Name
    { regex: /^(?:pub\s+)?type\s+(\w+)/gm, kind: 'type' as SymbolKind },
    // const NAME or static NAME
    { regex: /^(?:pub\s+)?(?:const|static)\s+(\w+)/gm, kind: 'constant' as SymbolKind },
  ];

  for (const { regex, kind } of patterns) {
    let match;
    regex.lastIndex = 0;

    while ((match = regex.exec(content)) !== null) {
      const name = match[1];
      const beforeMatch = content.substring(0, match.index);
      const line = beforeMatch.split('\n').length;
      const lineContent = lines[line - 1]?.trim() || '';

      symbols.push({
        name,
        kind,
        file,
        line,
        column: 0,
        signature: lineContent.substring(0, 100),
        exported: lineContent.startsWith('pub'),
      });
    }
  }

  return symbols;
}

// Build a searchable index
export function buildSymbolIndex(allSymbols: Symbol[]): SymbolIndex {
  const byName = new Map<string, Symbol[]>();
  const byFile = new Map<string, Symbol[]>();
  const byKind = new Map<SymbolKind, Symbol[]>();

  for (const symbol of allSymbols) {
    // By name
    const nameList = byName.get(symbol.name) || [];
    nameList.push(symbol);
    byName.set(symbol.name, nameList);

    // By file
    const fileList = byFile.get(symbol.file) || [];
    fileList.push(symbol);
    byFile.set(symbol.file, fileList);

    // By kind
    const kindList = byKind.get(symbol.kind) || [];
    kindList.push(symbol);
    byKind.set(symbol.kind, kindList);
  }

  return { symbols: allSymbols, byName, byFile, byKind };
}

// Search symbols by name (fuzzy match)
export function searchSymbols(index: SymbolIndex, query: string): Symbol[] {
  const lowerQuery = query.toLowerCase();
  const results: Symbol[] = [];

  for (const [name, symbols] of index.byName) {
    if (name.toLowerCase().includes(lowerQuery)) {
      results.push(...symbols);
    }
  }

  // Sort by relevance (exact match first, then starts with, then contains)
  results.sort((a, b) => {
    const aLower = a.name.toLowerCase();
    const bLower = b.name.toLowerCase();
    const aExact = aLower === lowerQuery;
    const bExact = bLower === lowerQuery;
    const aStarts = aLower.startsWith(lowerQuery);
    const bStarts = bLower.startsWith(lowerQuery);

    if (aExact !== bExact) return aExact ? -1 : 1;
    if (aStarts !== bStarts) return aStarts ? -1 : 1;
    return a.name.localeCompare(b.name);
  });

  return results;
}
