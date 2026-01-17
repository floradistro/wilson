import { readFileSync, statSync, createReadStream } from 'fs';
import type { Tool, ToolResult } from '../types.js';

interface PeekParams {
  file_path: string;
  limit?: number;
  aggregate?: {
    groupBy: string;
    sumFields?: string[];
    countField?: string;
  };
}

const MAX_FILE_SIZE_FULL_READ = 10 * 1024 * 1024; // 10MB

function formatBytes(bytes: number): string {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  if (bytes < 1024 * 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  return (bytes / (1024 * 1024 * 1024)).toFixed(2) + ' GB';
}

async function streamJsonSummary(
  filePath: string,
  maxRecords: number
): Promise<{
  records: Record<string, unknown>[];
  totalSize: number;
  totalSizeFormatted: string;
  fields: string[];
  recordCount: number;
  error: string | null;
}> {
  return new Promise((resolve) => {
    const results = {
      records: [] as Record<string, unknown>[],
      totalSize: 0,
      totalSizeFormatted: '',
      fields: [] as string[],
      recordCount: 0,
      error: null as string | null,
    };

    try {
      const stats = statSync(filePath);
      results.totalSize = stats.size;
      results.totalSizeFormatted = formatBytes(stats.size);

      // For small files, just read directly
      if (stats.size < MAX_FILE_SIZE_FULL_READ) {
        const content = readFileSync(filePath, 'utf8');
        const data = JSON.parse(content);
        const fieldsSet = new Set<string>();

        if (Array.isArray(data)) {
          results.recordCount = data.length;
          results.records = data.slice(0, maxRecords);
          if (data.length > 0) {
            Object.keys(data[0]).forEach((k) => fieldsSet.add(k));
          }
        } else {
          results.records = [data];
          results.recordCount = 1;
          Object.keys(data).forEach((k) => fieldsSet.add(k));
        }
        results.fields = Array.from(fieldsSet);
        resolve(results);
        return;
      }

      // For large files, stream and sample
      let buffer = '';
      let inArray = false;
      let depth = 0;
      let recordStart = -1;
      let recordsFound = 0;
      const fieldsSet = new Set<string>();

      const stream = createReadStream(filePath, { encoding: 'utf8', highWaterMark: 64 * 1024 });

      stream.on('data', (chunk: string) => {
        if (recordsFound >= maxRecords) {
          stream.destroy();
          return;
        }

        buffer += chunk;

        for (let i = 0; i < buffer.length && recordsFound < maxRecords; i++) {
          const char = buffer[i];
          if (char === '[' && !inArray) {
            inArray = true;
            continue;
          }
          if (!inArray) continue;

          if (char === '{') {
            if (depth === 0) recordStart = i;
            depth++;
          } else if (char === '}') {
            depth--;
            if (depth === 0 && recordStart >= 0) {
              try {
                const record = JSON.parse(buffer.slice(recordStart, i + 1));
                results.records.push(record);
                Object.keys(record).forEach((k) => fieldsSet.add(k));
                recordsFound++;
              } catch {
                // Skip malformed records
              }
              recordStart = -1;
            }
          }
        }

        if (recordStart >= 0) {
          buffer = buffer.slice(recordStart);
          recordStart = 0;
        } else {
          buffer = '';
        }
      });

      stream.on('end', () => {
        if (results.records.length > 0) {
          const avgRecordSize = results.totalSize / results.records.length;
          results.recordCount = Math.round(results.totalSize / avgRecordSize);
        }
        results.fields = Array.from(fieldsSet);
        resolve(results);
      });

      stream.on('error', (err) => {
        results.error = err.message;
        results.fields = Array.from(fieldsSet);
        resolve(results);
      });
    } catch (err) {
      results.error = err instanceof Error ? err.message : 'Failed to read file';
      resolve(results);
    }
  });
}

export const peekTool: Tool = {
  name: 'Peek',
  description: 'Sample large JSON/JSONL files. Returns schema, samples, and optional aggregations.',

  async execute(params: Record<string, unknown>): Promise<ToolResult> {
    const { file_path, limit = 100, aggregate } = params as unknown as PeekParams;

    if (!file_path) {
      return { success: false, error: 'Missing file_path' };
    }

    try {
      const summary = await streamJsonSummary(file_path, limit);

      // If aggregation requested, compute it
      if (aggregate && summary.records.length > 0) {
        const { groupBy, sumFields = [] } = aggregate;
        const groups: Record<string, Record<string, number>> = {};

        for (const record of summary.records) {
          const key = String(record[groupBy] || '(unknown)');
          if (!groups[key]) {
            groups[key] = { _count: 0 };
            sumFields.forEach((f) => (groups[key][f] = 0));
          }
          groups[key]._count++;
          sumFields.forEach((f) => {
            const val = parseFloat(String(record[f] || 0).replace(/[^0-9.-]/g, ''));
            if (!isNaN(val)) groups[key][f] += val;
          });
        }

        const aggregation = Object.entries(groups)
          .map(([key, vals]) => ({ [groupBy]: key, ...vals }))
          .sort((a, b) => {
            const aVal = (a[sumFields[0]] as number) || (a._count as number) || 0;
            const bVal = (b[sumFields[0]] as number) || (b._count as number) || 0;
            return bVal - aVal;
          })
          .slice(0, 20);

        const { error: _error, ...rest } = summary;
        return { success: true, ...rest, aggregation };
      }

      const { error: _error2, ...rest2 } = summary;
      return { success: true, ...rest2 };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : 'Peek failed' };
    }
  },
};
