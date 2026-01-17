import { config } from '../config.js';

// =============================================================================
// Simple Embeddings for Semantic Search
// Uses a lightweight local approach - no external API calls required
// =============================================================================

export interface EmbeddingResult {
  text: string;
  embedding: number[];
  file: string;
  startLine: number;
  endLine: number;
}

export interface SearchResult {
  text: string;
  file: string;
  startLine: number;
  endLine: number;
  score: number;
}

// Chunk code into meaningful segments for embedding
export function chunkCode(
  content: string,
  file: string,
  options: { maxChunkSize?: number; overlap?: number } = {}
): Array<{ text: string; startLine: number; endLine: number }> {
  const { maxChunkSize = 500, overlap = 50 } = options;
  const lines = content.split('\n');
  const chunks: Array<{ text: string; startLine: number; endLine: number }> = [];

  // Try to chunk by logical boundaries (functions, classes, etc.)
  const boundaries = findLogicalBoundaries(content);

  if (boundaries.length > 0) {
    // Chunk by logical boundaries
    for (const boundary of boundaries) {
      const text = lines.slice(boundary.start, boundary.end + 1).join('\n');
      if (text.trim().length > 20) {
        chunks.push({
          text: text.slice(0, maxChunkSize * 2), // Allow slightly larger for logical units
          startLine: boundary.start + 1,
          endLine: boundary.end + 1,
        });
      }
    }
  } else {
    // Fall back to sliding window
    let start = 0;
    while (start < lines.length) {
      const end = Math.min(start + Math.ceil(maxChunkSize / 40), lines.length);
      const text = lines.slice(start, end).join('\n');

      if (text.trim().length > 20) {
        chunks.push({
          text: text.slice(0, maxChunkSize),
          startLine: start + 1,
          endLine: end,
        });
      }

      start = end - Math.ceil(overlap / 40);
      if (start <= chunks[chunks.length - 1]?.startLine - 1) {
        start = end;
      }
    }
  }

  return chunks;
}

// Find logical boundaries in code (functions, classes, etc.)
function findLogicalBoundaries(content: string): Array<{ start: number; end: number }> {
  const lines = content.split('\n');
  const boundaries: Array<{ start: number; end: number }> = [];

  // Patterns that typically start new logical blocks
  const startPatterns = [
    /^(?:export\s+)?(?:async\s+)?function\s+\w+/,
    /^(?:export\s+)?(?:abstract\s+)?class\s+\w+/,
    /^(?:export\s+)?interface\s+\w+/,
    /^(?:export\s+)?type\s+\w+\s*=/,
    /^def\s+\w+\s*\(/,
    /^class\s+\w+/,
    /^func\s+(?:\([^)]+\)\s+)?\w+/,
    /^(?:pub\s+)?(?:async\s+)?fn\s+\w+/,
    /^(?:pub\s+)?struct\s+\w+/,
    /^(?:pub\s+)?impl\s+/,
  ];

  let currentStart: number | null = null;
  let braceDepth = 0;
  let inBlock = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    // Check if this line starts a new block
    const startsBlock = startPatterns.some(p => p.test(trimmed));

    if (startsBlock && !inBlock) {
      currentStart = i;
      inBlock = true;
      braceDepth = 0;
    }

    if (inBlock) {
      // Count braces
      for (const char of line) {
        if (char === '{') braceDepth++;
        if (char === '}') braceDepth--;
      }

      // Block ends when braces balance or we hit another block start
      if (braceDepth <= 0 && currentStart !== null && i > currentStart) {
        boundaries.push({ start: currentStart, end: i });
        inBlock = false;
        currentStart = null;
        braceDepth = 0;
      }
    }
  }

  // Handle unclosed block
  if (currentStart !== null) {
    boundaries.push({ start: currentStart, end: lines.length - 1 });
  }

  return boundaries;
}

// =============================================================================
// TF-IDF Based Local Embeddings (No API calls)
// =============================================================================

// Simple tokenizer
function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .split(/\s+/)
    .filter(t => t.length > 2 && !STOP_WORDS.has(t));
}

const STOP_WORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for',
  'of', 'with', 'by', 'from', 'as', 'is', 'was', 'are', 'were', 'been',
  'be', 'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
  'should', 'may', 'might', 'must', 'shall', 'can', 'need', 'dare', 'ought',
  'used', 'this', 'that', 'these', 'those', 'i', 'you', 'he', 'she', 'it',
  'we', 'they', 'what', 'which', 'who', 'whom', 'whose', 'where', 'when',
  'why', 'how', 'all', 'each', 'every', 'both', 'few', 'more', 'most',
  'other', 'some', 'such', 'no', 'nor', 'not', 'only', 'own', 'same', 'so',
  'than', 'too', 'very', 'just', 'also', 'now', 'here', 'there', 'then',
  'once', 'if', 'else', 'elif', 'return', 'import', 'from', 'const', 'let',
  'var', 'function', 'class', 'def', 'async', 'await', 'export', 'default',
]);

// Build vocabulary from all documents
export function buildVocabulary(documents: string[]): Map<string, number> {
  const vocab = new Map<string, number>();
  let idx = 0;

  for (const doc of documents) {
    const tokens = tokenize(doc);
    for (const token of tokens) {
      if (!vocab.has(token)) {
        vocab.set(token, idx++);
      }
    }
  }

  return vocab;
}

// Calculate TF-IDF vector for a document
export function calculateTfIdf(
  document: string,
  vocab: Map<string, number>,
  idfScores: Map<string, number>
): number[] {
  const tokens = tokenize(document);
  const tf = new Map<string, number>();

  // Calculate term frequency
  for (const token of tokens) {
    tf.set(token, (tf.get(token) || 0) + 1);
  }

  // Normalize TF
  const maxTf = Math.max(...tf.values(), 1);
  for (const [term, freq] of tf) {
    tf.set(term, freq / maxTf);
  }

  // Build TF-IDF vector
  const vector = new Array(vocab.size).fill(0);
  for (const [term, tfScore] of tf) {
    const idx = vocab.get(term);
    if (idx !== undefined) {
      const idf = idfScores.get(term) || 0;
      vector[idx] = tfScore * idf;
    }
  }

  return vector;
}

// Calculate IDF scores from document collection
export function calculateIdfScores(
  documents: string[],
  vocab: Map<string, number>
): Map<string, number> {
  const docFreq = new Map<string, number>();
  const n = documents.length;

  // Count document frequency for each term
  for (const doc of documents) {
    const tokens = new Set(tokenize(doc));
    for (const token of tokens) {
      docFreq.set(token, (docFreq.get(token) || 0) + 1);
    }
  }

  // Calculate IDF
  const idfScores = new Map<string, number>();
  for (const [term] of vocab) {
    const df = docFreq.get(term) || 0;
    idfScores.set(term, Math.log((n + 1) / (df + 1)) + 1);
  }

  return idfScores;
}

// Cosine similarity between two vectors
export function cosineSimilarity(a: number[], b: number[]): number {
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }

  const magnitude = Math.sqrt(normA) * Math.sqrt(normB);
  return magnitude === 0 ? 0 : dotProduct / magnitude;
}

// =============================================================================
// Semantic Index
// =============================================================================

export interface SemanticIndex {
  chunks: Array<{
    text: string;
    file: string;
    startLine: number;
    endLine: number;
    vector: number[];
  }>;
  vocab: Map<string, number>;
  idfScores: Map<string, number>;
}

// Build semantic index from code chunks
export function buildSemanticIndex(
  chunks: Array<{ text: string; file: string; startLine: number; endLine: number }>
): SemanticIndex {
  const documents = chunks.map(c => c.text);

  // Build vocabulary and IDF scores
  const vocab = buildVocabulary(documents);
  const idfScores = calculateIdfScores(documents, vocab);

  // Calculate vectors for all chunks
  const indexedChunks = chunks.map(chunk => ({
    ...chunk,
    vector: calculateTfIdf(chunk.text, vocab, idfScores),
  }));

  return {
    chunks: indexedChunks,
    vocab,
    idfScores,
  };
}

// Search semantic index
export function searchSemanticIndex(
  index: SemanticIndex,
  query: string,
  limit: number = 10
): SearchResult[] {
  const queryVector = calculateTfIdf(query, index.vocab, index.idfScores);

  const results = index.chunks
    .map(chunk => ({
      text: chunk.text,
      file: chunk.file,
      startLine: chunk.startLine,
      endLine: chunk.endLine,
      score: cosineSimilarity(queryVector, chunk.vector),
    }))
    .filter(r => r.score > 0.05) // Minimum threshold
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);

  return results;
}

// Serialize index for storage
export function serializeSemanticIndex(index: SemanticIndex): string {
  return JSON.stringify({
    chunks: index.chunks,
    vocab: Array.from(index.vocab.entries()),
    idfScores: Array.from(index.idfScores.entries()),
  });
}

// Deserialize index from storage
export function deserializeSemanticIndex(data: string): SemanticIndex {
  const parsed = JSON.parse(data);
  return {
    chunks: parsed.chunks,
    vocab: new Map(parsed.vocab),
    idfScores: new Map(parsed.idfScores),
  };
}
