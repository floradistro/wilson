import { readFile } from 'fs/promises';
import { statSync, readdirSync } from 'fs';
import { join, dirname, basename } from 'path';
import type { Tool, ToolResult } from '../types.js';

interface SumParams {
  path: string;
  group?: string;
  fields?: string[];
  top?: number;
  type?: 'product' | 'invoice' | 'itemized' | 'daily' | 'auto';
}

const PARALLEL_BATCH = 10;

function formatBytes(bytes: number): string {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  if (bytes < 1024 * 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  return (bytes / (1024 * 1024 * 1024)).toFixed(2) + ' GB';
}

export const sumTool: Tool = {
  name: 'Sum',
  description: 'Aggregate JSON files in a directory. Smart handling of COVA exports to avoid double-counting.',

  async execute(params: Record<string, unknown>): Promise<ToolResult> {
    const {
      path: inputPath,
      group: groupBy = 'Product',
      fields: sumFields = ['Gross Sales', 'Items Sold', 'Net Sold'],
      top: topN = 20,
      type: reportType = 'auto',
    } = params as unknown as SumParams;

    if (!inputPath) {
      return { success: false, error: 'Missing path' };
    }

    // Find all JSON files
    let jsonFiles: string[] = [];
    try {
      const pathStat = statSync(inputPath);
      if (pathStat.isDirectory()) {
        const findJsonFiles = (dir: string) => {
          const entries = readdirSync(dir, { withFileTypes: true });
          for (const entry of entries) {
            const fullPath = join(dir, entry.name);
            if (entry.isDirectory()) {
              findJsonFiles(fullPath);
            } else if (entry.name.endsWith('.json')) {
              jsonFiles.push(fullPath);
            }
          }
        };
        findJsonFiles(inputPath);
      } else {
        jsonFiles = [inputPath];
      }
    } catch (err) {
      return { success: false, error: `Path error: ${err instanceof Error ? err.message : 'unknown'}` };
    }

    // Filter files to avoid double-counting for COVA exports
    if (reportType === 'auto' && jsonFiles.length > 1) {
      const byLocation: Record<string, string[]> = {};
      for (const f of jsonFiles) {
        const dir = dirname(f);
        if (!byLocation[dir]) byLocation[dir] = [];
        byLocation[dir].push(f);
      }

      const selectedFiles: string[] = [];
      for (const files of Object.values(byLocation)) {
        const product = files.find((f) => /Sales by Product(?! per Day| & Location)/i.test(basename(f)));
        const productLoc = files.find((f) => /Sales by Product & Location(?! per Day)/i.test(basename(f)));
        const classification = files.find((f) => /Sales by Classification/i.test(basename(f)));
        const productPerDay = files.find((f) => /Sales by Product per Day/i.test(basename(f)));

        if (product) selectedFiles.push(product);
        else if (productLoc) selectedFiles.push(productLoc);
        else if (classification) selectedFiles.push(classification);
        else if (productPerDay) selectedFiles.push(productPerDay);
      }

      if (selectedFiles.length > 0) jsonFiles = selectedFiles;
    } else if (reportType !== 'auto') {
      const patterns: Record<string, RegExp> = {
        product: /Sales by Product(?! per Day| & Location)/i,
        invoice: /Sales by Invoice/i,
        itemized: /Itemized Sales/i,
        daily: /per Day/i,
      };
      if (patterns[reportType]) {
        jsonFiles = jsonFiles.filter((f) => patterns[reportType].test(basename(f)));
      }
    }

    // Process files and aggregate
    const aggregated: Record<string, Record<string, number>> = {};
    let totalRecords = 0;
    let totalSize = 0;

    const processFile = async (filePath: string) => {
      try {
        const stats = statSync(filePath);
        totalSize += stats.size;

        const content = await readFile(filePath, 'utf8');
        const data = JSON.parse(content);

        if (!Array.isArray(data)) return;

        for (const record of data) {
          const key = String(record[groupBy] || '(unknown)').slice(0, 50);
          if (!aggregated[key]) {
            aggregated[key] = { _count: 0 };
            sumFields.forEach((f) => (aggregated[key][f] = 0));
          }
          aggregated[key]._count++;
          totalRecords++;

          sumFields.forEach((f) => {
            const val = parseFloat(String(record[f] || 0).replace(/[^0-9.-]/g, ''));
            if (!isNaN(val)) aggregated[key][f] += val;
          });
        }
      } catch {
        // Skip files that can't be processed
      }
    };

    // Process in parallel batches
    for (let i = 0; i < jsonFiles.length; i += PARALLEL_BATCH) {
      const batch = jsonFiles.slice(i, i + PARALLEL_BATCH);
      await Promise.all(batch.map(processFile));
    }

    // Sort and return top N
    const mainSumField = sumFields[0] || '_count';
    const results = Object.entries(aggregated)
      .map(([key, vals]) => ({ [groupBy]: key, ...vals }))
      .sort((a, b) => ((b[mainSumField] as number) || 0) - ((a[mainSumField] as number) || 0))
      .slice(0, topN);

    // Calculate totals
    const allResults = Object.entries(aggregated).map(([key, vals]) => ({ [groupBy]: key, ...vals }));
    const totals: Record<string, number> = { _count: totalRecords };
    sumFields.forEach((f) => {
      totals[f] = allResults.reduce((sum, r) => sum + ((r[f] as number) || 0), 0);
    });

    return {
      success: true,
      groupBy,
      sumFields,
      filesProcessed: jsonFiles.length,
      filesUsed: jsonFiles.map((f) => basename(f)),
      totalRecords,
      totalSizeFormatted: formatBytes(totalSize),
      results,
      totals,
      chart: {
        type: 'bar',
        title: `Top ${topN} by ${mainSumField}`,
        data: results.slice(0, 10).map((r) => ({
          label: r[groupBy] as string,
          value: (r[mainSumField] as number) || 0,
        })),
      },
    };
  },
};
