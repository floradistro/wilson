/**
 * Headless test - tests full API + tool execution without UI
 * Usage: wilson test "your message here"
 */

import { sendChatRequest } from '../services/api.js';
import { executeToolByName } from '../tools/index.js';
import { loadAuth } from '../services/storage.js';

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
  console.log('=== HEADLESS TEST ===\n');

  // Load auth
  const auth = loadAuth();
  if (!auth?.accessToken || !auth?.storeId) {
    console.error('ERROR: Not logged in. Run "wilson" first to authenticate.');
    process.exit(1);
  }

  console.log(`Store: ${auth.storeName || auth.storeId}`);
  console.log(`Message: "${message}"\n`);
  console.log('--- Streaming Response ---\n');

  let assistantContent = '';
  let pendingTools: StreamEvent['pending_tools'] = null;
  let toolResults: Array<{ tool_use_id: string; content: string }> | undefined;
  let depth = 0;

  while (depth < 5) {
    depth++;
    console.log(`[Loop ${depth}]`);

    // Make API request
    const response = await sendChatRequest({
      message,
      history: [],
      accessToken: auth.accessToken,
      storeId: auth.storeId,
      toolResults,
      pendingAssistantContent: assistantContent || undefined,
    });

    // Process stream
    for await (const event of processStream(response)) {
      const type = event.type;

      switch (type) {
        case 'text_delta':
        case 'text':
        case 'chunk':
          const text = event.text || event.content || '';
          process.stdout.write(text);
          assistantContent += text;
          break;

        case 'content_block_delta':
          const deltaText = event.delta?.text || '';
          process.stdout.write(deltaText);
          assistantContent += deltaText;
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
          console.log(`\n[PAUSE FOR TOOLS] ${event.pending_tools?.length || 0} tools pending`);
          pendingTools = event.pending_tools;
          if (pendingTools) {
            for (const t of pendingTools) {
              console.log(`  - Tool: ${t.name} (${t.id})`);
              console.log(`    Input: ${JSON.stringify(t.input).slice(0, 200)}`);
            }
          }
          if (event.assistant_content) {
            assistantContent = event.assistant_content;
          }
          break;

        case 'error':
          console.error(`\n[ERROR] ${event.error}`);
          process.exit(1);

        case 'done':
        case 'message_stop':
          console.log('\n[STREAM DONE]');
          break;

        default:
          // Log unknown types
          if (!['message_start', 'content_block_stop', 'message_delta', 'ping', 'input_json_delta'].includes(type)) {
            console.log(`\n[EVENT] ${type}: ${JSON.stringify(event).slice(0, 100)}`);
          }
      }
    }

    // Execute pending tools
    if (pendingTools && pendingTools.length > 0) {
      console.log('\n--- Executing Tools ---\n');
      toolResults = [];

      for (const tool of pendingTools) {
        console.log(`Executing: ${tool.name}`);
        console.log(`  Input: ${JSON.stringify(tool.input).slice(0, 300)}`);

        const result = await executeToolByName(tool.name, tool.input);
        console.log(`  Result: ${result.success ? 'SUCCESS' : 'FAILED: ' + result.error}`);

        if (result.success && result.content) {
          const preview = typeof result.content === 'string'
            ? result.content.slice(0, 200)
            : JSON.stringify(result.content).slice(0, 200);
          console.log(`  Preview: ${preview}...`);
        }

        toolResults.push({
          tool_use_id: tool.id,
          content: JSON.stringify(result),
        });
      }

      console.log('\n--- Continuing with tool results ---\n');
      pendingTools = null;
    } else {
      // No tools, we're done
      break;
    }
  }

  console.log('\n=== TEST COMPLETE ===');
  process.exit(0);
}
