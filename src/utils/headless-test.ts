/**
 * Headless test - tests full API + tool execution without UI
 * Usage: wilson test "your message here"
 */

import { sendChatRequest } from '../services/api.js';
import { executeToolByName } from '../tools/index.js';
import { authStore } from '../stores/authStore.js';
import { flushTelemetrySync } from '../services/telemetry.js';
import chalk from 'chalk';
import { highlight } from 'cli-highlight';

// Colors - Material-inspired palette matching the UI
const c = {
  user: chalk.hex('#7DC87D'),
  assistant: chalk.hex('#89DDFF'),
  tool: chalk.hex('#FFCB6B'),
  toolDone: chalk.hex('#7DC87D'),
  dim: chalk.hex('#546E7A'),
  error: chalk.hex('#E07070'),
  header: chalk.bold.hex('#82AAFF'),
  text: chalk.hex('#C0C0C0'),
  code: chalk.hex('#C792EA'),
};

// Syntax highlighting theme
const theme = {
  keyword: chalk.hex('#C792EA'),
  built_in: chalk.hex('#82AAFF'),
  type: chalk.hex('#FFCB6B'),
  literal: chalk.hex('#F78C6C'),
  number: chalk.hex('#F78C6C'),
  string: chalk.hex('#C3E88D'),
  comment: chalk.hex('#546E7A'),
  function: chalk.hex('#82AAFF'),
};

// Format markdown-like text with colors
function formatText(text: string): string {
  // Code blocks
  text = text.replace(/```(\w*)\n([\s\S]*?)```/g, (_, lang, code) => {
    try {
      const highlighted = highlight(code.trim(), { language: lang || 'text', ignoreIllegals: true, theme });
      const lines = highlighted.split('\n');
      const bordered = lines.map((l, i) => c.dim('│') + chalk.hex('#3A3A3A')(` ${String(i+1).padStart(3)} `) + l).join('\n');
      return `\n${c.dim('╭─')} ${c.dim(lang || 'code')}\n${bordered}\n${c.dim('╰─')}\n`;
    } catch { return code; }
  });

  // Inline code
  text = text.replace(/`([^`]+)`/g, (_, code) => c.code(code));

  // Bold
  text = text.replace(/\*\*([^*]+)\*\*/g, (_, t) => chalk.bold(t));

  // Headers
  text = text.replace(/^### (.+)$/gm, (_, t) => '\n' + c.dim('   ') + chalk.bold.hex('#A0A0A0')(t));
  text = text.replace(/^## (.+)$/gm, (_, t) => '\n' + c.dim('  ') + chalk.bold.hex('#89DDFF')(t));
  text = text.replace(/^# (.+)$/gm, (_, t) => '\n' + c.dim(' ') + chalk.bold.hex('#82AAFF')(t));

  // Bullets
  text = text.replace(/^(\s*)[-*] (.+)$/gm, (_, indent, t) =>
    indent + c.user('• ') + c.text(t));

  // Action lines
  text = text.replace(/^(Let me|I'll|Now |First,|Next,|Then,)/gm, (match) =>
    c.user('→ ') + c.text(match));

  return text;
}

interface StreamEvent {
  type: string;
  content?: string;
  text?: string;
  delta?: { text?: string };
  tool?: { id: string; name: string; input: Record<string, unknown> };
  pending_tools?: Array<{ id: string; name: string; input: Record<string, unknown> }>;
  assistant_content?: string;
  error?: string;
}

// Parse SSE line
function parseSSELine(line: string): StreamEvent | null {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith(':')) return null;

  if (trimmed.startsWith('data: ')) {
    const data = trimmed.slice(6);
    if (data === '[DONE]') return { type: 'done' };
    try {
      return JSON.parse(data);
    } catch {
      return null;
    }
  }
  return null;
}

// Process stream
async function* processStream(response: Response): AsyncGenerator<StreamEvent> {
  if (!response.body) {
    yield { type: 'error', error: 'No response body' };
    return;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        const event = parseSSELine(line);
        if (event) {
          yield event;
          if (event.type === 'done' || event.type === 'error') return;
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}

// Main test function
export async function runHeadlessTest(message: string) {
  console.log(c.header('\n  Wilson CLI Test\n'));

  // Get auth from store (auto-loads from disk)
  const auth = authStore.getState();
  if (!auth.accessToken || !auth.storeId) {
    console.error(c.error('ERROR: Not logged in. Run "wilson" first to authenticate.'));
    process.exit(1);
  }

  console.log(c.dim('  Store: ') + c.text(auth.storeName || auth.storeId));
  console.log(c.user('\n  ❯ ') + c.text(message) + '\n');

  // Accumulate conversation history across tool calls
  // IMPORTANT: Include the initial user message - this is required for proper conversation flow
  // See VERIFY_LOCAL_TOOLS.md lines 186-191 for the expected structure
  let conversationHistory: Array<{ role: string; content: unknown }> = [
    { role: 'user', content: message }
  ];
  let pendingTools: StreamEvent['pending_tools'] = null;
  let assistantContentBlocks: unknown[] = [];
  let depth = 0;

  let streamedText = '';

  while (depth < 10) {
    depth++;
    if (depth > 1) console.log(c.dim(`\n  ─── Continuation ${depth} ───\n`));
    streamedText = '';

    // Make API request with accumulated conversation history
    const response = await sendChatRequest({
      message,
      conversationHistory,
      accessToken: auth.accessToken,
      storeId: auth.storeId,
    });

    // Process stream
    for await (const event of processStream(response)) {
      const type = event.type;

      switch (type) {
        case 'text_delta':
        case 'text':
        case 'chunk':
          const text = event.text || event.content || '';
          streamedText += text;
          break;

        case 'content_block_delta':
          const deltaText = event.delta?.text || '';
          streamedText += deltaText;
          break;

        case 'content_block_start':
          const block = (event as Record<string, unknown>).content_block as Record<string, unknown> | undefined;
          if (block?.type === 'tool_use') {
            console.log(`\n[TOOL START] ${block.name} (${block.id})`);
          }
          break;

        case 'tool_start':
        case 'tool_use':
          if (event.tool) {
            console.log(`\n[TOOL] ${event.tool.name} (${event.tool.id})`);
            console.log(`  Input: ${JSON.stringify(event.tool.input).slice(0, 200)}`);
          }
          break;

        case 'pause_for_tools':
          pendingTools = event.pending_tools;
          if (pendingTools) {
            console.log('');
            for (const t of pendingTools) {
              console.log(c.tool('  ⟳ ') + c.assistant(t.name) + c.dim(` (${t.id.slice(-8)})`));
            }
          }
          // Capture assistant content blocks (includes tool_use blocks) for history
          if (event.assistant_content) {
            assistantContentBlocks = event.assistant_content as unknown[];
          }
          break;

        case 'error':
          console.error(`\n[ERROR] ${event.error}`);
          process.exit(1);

        case 'done':
        case 'message_stop':
          // Final formatted output if we collected text
          if (streamedText && !pendingTools) {
            console.log('\n' + formatText(streamedText));
          }
          break;

        default:
          // Log tool errors in full
          if (type === 'tool_error') {
            console.log(c.error(`\n  [TOOL ERROR] ${(event as any).tool_name}: ${(event as any).result || JSON.stringify(event)}`));
          } else if (!['message_start', 'content_block_stop', 'message_delta', 'ping', 'input_json_delta', 'tool_result'].includes(type)) {
            console.log(c.dim(`\n  [${type}] ${JSON.stringify(event).slice(0, 150)}`));
          }
      }
    }

    // Execute pending tools
    if (pendingTools && pendingTools.length > 0) {
      // Add assistant response (with tool_use blocks) to conversation history
      if (assistantContentBlocks.length > 0) {
        conversationHistory.push({ role: 'assistant', content: assistantContentBlocks });
      }

      const toolResultBlocks: Array<{ type: string; tool_use_id: string; content: string }> = [];

      for (const tool of pendingTools) {
        const result = await executeToolByName(tool.name, tool.input);
        const icon = result.success ? c.toolDone('  ✓ ') : c.error('  ✗ ');
        console.log(icon + c.assistant(tool.name));

        if (result.success && result.content) {
          // Show preview of result
          const content = typeof result.content === 'string' ? result.content : JSON.stringify(result.content);
          const lines = content.split('\n').slice(0, 6);
          if (lines.length > 0) {
            console.log(c.dim('    ╭─'));
            lines.forEach(line => {
              const trimmed = line.slice(0, 72);
              console.log(c.dim('    │ ') + c.text(trimmed + (line.length > 72 ? '...' : '')));
            });
            if (content.split('\n').length > 6) {
              console.log(c.dim('    │ ... ' + (content.split('\n').length - 6) + ' more lines'));
            }
            console.log(c.dim('    ╰─'));
          }
        }

        toolResultBlocks.push({
          type: 'tool_result',
          tool_use_id: tool.id,
          content: JSON.stringify(result),
        });
      }

      // Add tool results to conversation history as user message
      conversationHistory.push({ role: 'user', content: toolResultBlocks });
      pendingTools = null;
      assistantContentBlocks = [];
    } else {
      // No tools, we're done
      break;
    }
  }

  console.log(c.dim('\n  ─────────────────────────────────────\n'));

  // Flush telemetry before exit
  await flushTelemetrySync();
  process.exit(0);
}
