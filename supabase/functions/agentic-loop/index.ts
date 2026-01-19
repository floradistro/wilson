/**
 * Wilson Agentic Loop - Multi-Provider AI Backend
 *
 * Supports:
 * - Anthropic Claude (Opus 4, Sonnet 4, 3.5 Sonnet, 3.5 Haiku)
 * - Google Gemini (2.0 Flash, 1.5 Pro, 1.5 Flash)
 * - OpenAI (GPT-4o, o1) - future
 *
 * Features:
 * - Streaming responses (SSE)
 * - Tool/function calling
 * - SEMANTIC TOOL SEARCH - only sends relevant tools (90% token reduction)
 * - Automatic provider switching
 * - Token tracking
 */

// NOTE: Supabase client not needed until semantic tool search is enabled
// import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';

// =============================================================================
// Configuration
// =============================================================================

// These would be used for semantic tool search when enabled:
// const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || 'https://uaednwpxursknmwdeejn.supabase.co';
// const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';

// =============================================================================
// Types
// =============================================================================

type AIProvider = 'anthropic' | 'gemini' | 'openai';

interface Message {
  role: 'user' | 'assistant' | 'system';
  content: string | ContentBlock[];
}

interface ContentBlock {
  type: 'text' | 'tool_use' | 'tool_result';
  text?: string;
  id?: string;
  name?: string;
  input?: Record<string, unknown>;
  tool_use_id?: string;
  content?: string;
  is_error?: boolean;
}

interface ToolSchema {
  name: string;
  description: string;
  input_schema?: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
  };
  parameters?: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
  };
}

interface AgenticRequest {
  message: string;
  history: Message[];
  store_id?: string;
  working_directory?: string;
  platform?: string;
  client?: string;
  format_hint?: string;
  local_tools?: ToolSchema[];
  tool_call_count?: number;
  loop_depth?: number;
  project_context?: string;
  codebase_summary?: string;
  style_instructions?: string;
  // Provider selection
  provider?: AIProvider;
  model?: string;
  // Semantic tool search options
  use_semantic_tools?: boolean;
  max_tool_categories?: number;
}

// =============================================================================
// Provider Configurations
// =============================================================================

const PROVIDER_CONFIG = {
  anthropic: {
    baseUrl: 'https://api.anthropic.com/v1/messages',
    defaultModel: 'claude-sonnet-4-20250514',
    apiKeyEnv: 'ANTHROPIC_API_KEY',
    maxTokens: 8192,
  },
  gemini: {
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/models',
    defaultModel: 'gemini-2.0-flash-exp',
    apiKeyEnv: 'GEMINI_API_KEY',
    maxTokens: 8192,
  },
  openai: {
    baseUrl: 'https://api.openai.com/v1/chat/completions',
    defaultModel: 'gpt-4o',
    apiKeyEnv: 'OPENAI_API_KEY',
    maxTokens: 4096,
  },
};

// =============================================================================
// Semantic Tool Search - DISABLED
// =============================================================================
// NOTE: Semantic tool search requires ai_tool_registry and ai_tool_categories tables
// with embeddings. These don't exist in the Wilson database yet.
// When enabled, this would:
// 1. Generate embedding for user query using OpenAI
// 2. Call get_relevant_tools() to find semantically matching tools
// 3. Merge with local tools to reduce token usage by ~90%
// For now, we use all local tools sent by the client.

// =============================================================================
// Anthropic Provider
// =============================================================================

async function callAnthropic(
  messages: Message[],
  systemPrompt: string,
  tools: ToolSchema[],
  model: string,
  stream: boolean
): Promise<Response> {
  const apiKey = Deno.env.get('ANTHROPIC_API_KEY');
  if (!apiKey) {
    throw new Error('ANTHROPIC_API_KEY not configured');
  }

  // Convert messages to Anthropic format
  const anthropicMessages = messages
    .filter(m => m.role !== 'system')
    .map(m => ({
      role: m.role,
      content: typeof m.content === 'string' ? m.content : m.content.map(formatAnthropicBlock),
    }));

  // Convert tools to Anthropic format and deduplicate by name
  const seenNames = new Set<string>();
  const anthropicTools: Array<{name: string; description: string; input_schema: unknown}> = [];
  for (const tool of tools) {
    // Skip duplicates (case-insensitive)
    const lowerName = tool.name.toLowerCase();
    if (seenNames.has(lowerName)) {
      continue;
    }
    seenNames.add(lowerName);

    // Handle both input_schema and parameters formats
    const schema = tool.input_schema || tool.parameters || { type: 'object', properties: {} };

    anthropicTools.push({
      name: tool.name,
      description: tool.description,
      input_schema: {
        type: 'object',
        properties: schema.properties || {},
        required: schema.required || [],
      },
    });
  }

  console.log(`[ANTHROPIC] Sending ${anthropicTools.length} tools to Claude`);

  const body: Record<string, unknown> = {
    model,
    max_tokens: PROVIDER_CONFIG.anthropic.maxTokens,
    system: systemPrompt,
    messages: anthropicMessages,
    stream,
  };

  if (anthropicTools.length > 0) {
    body.tools = anthropicTools;
  }

  return fetch(PROVIDER_CONFIG.anthropic.baseUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      // Anthropic beta features for better tool use
      'anthropic-beta': 'advanced-tool-use-2025-11-20,context-management-2025-06-27',
    },
    body: JSON.stringify(body),
  });
}

function formatAnthropicBlock(block: ContentBlock): Record<string, unknown> {
  switch (block.type) {
    case 'text':
      return { type: 'text', text: block.text };
    case 'tool_use':
      return { type: 'tool_use', id: block.id, name: block.name, input: block.input };
    case 'tool_result':
      return { type: 'tool_result', tool_use_id: block.tool_use_id, content: block.content, is_error: block.is_error };
    default:
      return { type: 'text', text: '' };
  }
}

// =============================================================================
// Gemini Provider
// =============================================================================

async function callGemini(
  messages: Message[],
  systemPrompt: string,
  tools: ToolSchema[],
  model: string,
  stream: boolean
): Promise<Response> {
  const apiKey = Deno.env.get('GEMINI_API_KEY');
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY not configured');
  }

  // Convert messages to Gemini format
  const geminiContents = messages
    .filter(m => m.role !== 'system')
    .map(m => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: typeof m.content === 'string'
        ? [{ text: m.content }]
        : m.content.map(formatGeminiPart),
    }));

  // Convert tools to Gemini format
  const geminiTools = tools.length > 0 ? [{
    functionDeclarations: tools.map(tool => {
      const schema = tool.input_schema || tool.parameters || { type: 'object', properties: {} };
      return {
        name: tool.name,
        description: tool.description,
        parameters: {
          type: 'object',
          properties: schema.properties || {},
          required: schema.required || [],
        },
      };
    }),
  }] : undefined;

  const body: Record<string, unknown> = {
    contents: geminiContents,
    systemInstruction: { parts: [{ text: systemPrompt }] },
    generationConfig: {
      maxOutputTokens: PROVIDER_CONFIG.gemini.maxTokens,
      temperature: 0.7,
    },
  };

  if (geminiTools) {
    body.tools = geminiTools;
    body.toolConfig = { functionCallingConfig: { mode: 'AUTO' } };
  }

  const endpoint = stream ? 'streamGenerateContent' : 'generateContent';
  const url = `${PROVIDER_CONFIG.gemini.baseUrl}/${model}:${endpoint}?key=${apiKey}${stream ? '&alt=sse' : ''}`;

  return fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function formatGeminiPart(block: ContentBlock): Record<string, unknown> {
  switch (block.type) {
    case 'text':
      return { text: block.text };
    case 'tool_use':
      return { functionCall: { name: block.name, args: block.input } };
    case 'tool_result':
      return { functionResponse: { name: block.tool_use_id?.split('_')[0], response: { content: block.content } } };
    default:
      return { text: '' };
  }
}

// =============================================================================
// Response Transformer - Convert provider responses to unified SSE format
// =============================================================================

function createUnifiedSSEStream(
  providerResponse: Response,
  provider: AIProvider
): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();

  return new ReadableStream({
    async start(controller) {
      if (provider === 'anthropic') {
        // Anthropic already uses our SSE format, pass through
        await streamPassthrough(providerResponse, controller);
      } else if (provider === 'gemini') {
        // Transform Gemini SSE to unified format
        await transformGeminiStream(providerResponse, controller, encoder);
      }
    },
  });
}

async function streamPassthrough(
  response: Response,
  controller: ReadableStreamDefaultController<Uint8Array>
) {
  const reader = response.body?.getReader();
  if (!reader) return;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      controller.enqueue(value);
    }
  } finally {
    controller.close();
  }
}

async function transformGeminiStream(
  response: Response,
  controller: ReadableStreamDefaultController<Uint8Array>,
  encoder: TextEncoder
) {
  const reader = response.body?.getReader();
  if (!reader) return;

  const decoder = new TextDecoder();
  let buffer = '';
  let messageId = `gemini_${Date.now()}`;
  let contentIndex = 0;
  let totalInputTokens = 0;
  let totalOutputTokens = 0;

  // Emit message_start
  controller.enqueue(encoder.encode(`data: ${JSON.stringify({
    type: 'message_start',
    message: { id: messageId, model: 'gemini', role: 'assistant', content: [], usage: { input_tokens: 0, output_tokens: 0 } }
  })}\n\n`));

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const data = line.slice(6);
        if (data === '[DONE]') continue;

        try {
          const chunk = JSON.parse(data);

          // Track usage
          if (chunk.usageMetadata) {
            totalInputTokens = chunk.usageMetadata.promptTokenCount || 0;
            totalOutputTokens = chunk.usageMetadata.candidatesTokenCount || 0;
          }

          // Process candidates
          if (chunk.candidates?.[0]?.content?.parts) {
            for (const part of chunk.candidates[0].content.parts) {
              if (part.text) {
                // Emit content_block_start for new text
                controller.enqueue(encoder.encode(`data: ${JSON.stringify({
                  type: 'content_block_start',
                  index: contentIndex,
                  content_block: { type: 'text', text: '' }
                })}\n\n`));

                // Emit text delta
                controller.enqueue(encoder.encode(`data: ${JSON.stringify({
                  type: 'content_block_delta',
                  index: contentIndex,
                  delta: { type: 'text_delta', text: part.text }
                })}\n\n`));

                // Emit content_block_stop
                controller.enqueue(encoder.encode(`data: ${JSON.stringify({
                  type: 'content_block_stop',
                  index: contentIndex
                })}\n\n`));

                contentIndex++;
              } else if (part.functionCall) {
                // Emit tool use
                const toolId = `${part.functionCall.name}_${Date.now()}`;
                controller.enqueue(encoder.encode(`data: ${JSON.stringify({
                  type: 'content_block_start',
                  index: contentIndex,
                  content_block: { type: 'tool_use', id: toolId, name: part.functionCall.name, input: part.functionCall.args }
                })}\n\n`));

                controller.enqueue(encoder.encode(`data: ${JSON.stringify({
                  type: 'content_block_stop',
                  index: contentIndex
                })}\n\n`));

                contentIndex++;
              }
            }
          }

          // Check for finish reason
          if (chunk.candidates?.[0]?.finishReason) {
            const stopReason = chunk.candidates[0].finishReason === 'STOP' ? 'end_turn' :
              chunk.candidates[0].finishReason === 'FUNCTION_CALL' ? 'tool_use' : 'end_turn';

            controller.enqueue(encoder.encode(`data: ${JSON.stringify({
              type: 'message_delta',
              delta: { stop_reason: stopReason },
              usage: { output_tokens: totalOutputTokens }
            })}\n\n`));
          }
        } catch {
          // Skip invalid JSON
        }
      }
    }

    // Emit message_stop
    controller.enqueue(encoder.encode(`data: ${JSON.stringify({
      type: 'message_stop'
    })}\n\n`));

  } finally {
    controller.close();
  }
}

// =============================================================================
// Main Handler
// =============================================================================

Deno.serve(async (req) => {
  // CORS
  if (req.method === 'OPTIONS') {
    return new Response('ok', {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
      },
    });
  }

  try {
    // Parse request
    const body: AgenticRequest = await req.json();
    const {
      message,
      history = [],
      store_id,
      local_tools = [],
      project_context,
      codebase_summary,
      style_instructions,
      provider = 'anthropic',
      model,
      // Semantic tool search disabled - these are ignored for now
      // use_semantic_tools = true,
      // max_tool_categories = 5,
    } = body;

    // Determine model to use
    const selectedModel = model || PROVIDER_CONFIG[provider]?.defaultModel || PROVIDER_CONFIG.anthropic.defaultModel;

    // ==========================================================================
    // TOOL SELECTION
    // ==========================================================================
    // Use local tools directly - semantic search disabled until ai_tool_registry is set up
    const finalTools: ToolSchema[] = local_tools;
    const selectedCategories: string[] = [];

    console.log(`[TOOLS] Using ${finalTools.length} local tools from client`);
    if (finalTools.length > 0) {
      console.log(`[TOOLS] First 5 tools: ${finalTools.slice(0, 5).map(t => t.name).join(', ')}`);
    }

    // Build system prompt
    let systemPrompt = `You are Wilson, an AI assistant for cannabis retail stores. You help with inventory management, sales analysis, and store operations.

TOOL SELECTION - USE THE RIGHT TOOL:
- Read: For reading FILE contents only. Never use on directories.
- LS: For listing directory contents. Use when you need to see what files exist.
- Glob: For finding files by pattern (e.g., **/*.tsx)
- Grep: For searching file contents by pattern
- Edit: For modifying existing files (requires Read first)
- Write: For creating new files or overwriting existing ones
- Bash: For running shell commands (npm, git, etc.)

PARALLEL TOOL CALLS - MAXIMIZE EFFICIENCY:
When you need multiple pieces of information, call ALL tools in a SINGLE response.
Example: To explore a codebase, call Read, Glob, and Grep together in ONE message.
Tools execute in parallel - calling 5 tools at once takes the same time as calling 1.
NEVER call tools one at a time when they can be batched.

CRITICAL RULES:
1. ONCE YOU RECEIVE TOOL RESULTS, RESPOND TO THE USER. Do NOT call more tools.
2. NEVER call the same tool twice with identical parameters.
3. When results say "[TOOL COMPLETE]", that data is DONE. Summarize it.
4. After successful tools, respond with TEXT to the user.
5. Batch multiple tool calls in ONE response whenever possible.
6. If Edit fails, DO NOT retry with the same old_string. Read the file to see actual content.
7. If Write succeeds, DO NOT write the same file again - it's already done.
8. After 2 failed attempts at the same operation, STOP and ask the user for help.
9. For dev servers: Use DevServer tool ONCE. If it succeeds, you're DONE - do NOT also run Bash npm run dev.
10. If DevServer start succeeds, the server IS running. Report success and stop.

Current store ID: ${store_id || 'unknown'}
Working directory: ${body.working_directory || 'unknown'}
Platform: ${body.platform || 'unknown'}

${selectedCategories.length > 0 ? `Available tool categories: ${selectedCategories.join(', ')}\n` : ''}
${codebase_summary ? `\n${codebase_summary}\n` : ''}
${project_context ? `Project Context:\n${project_context}\n` : ''}
${style_instructions ? `\n${style_instructions}` : ''}`;

    // Convert history to messages format
    const messages: Message[] = [
      ...history,
      { role: 'user' as const, content: message },
    ];

    // Call the appropriate provider
    let response: Response;

    if (provider === 'anthropic') {
      response = await callAnthropic(messages, systemPrompt, finalTools, selectedModel, true);
    } else if (provider === 'gemini') {
      response = await callGemini(messages, systemPrompt, finalTools, selectedModel, true);
    } else {
      return new Response(
        JSON.stringify({ error: `Unsupported provider: ${provider}` }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`${provider} API error:`, response.status, errorText);
      return new Response(
        JSON.stringify({ error: `${provider} API error: ${response.status}`, details: errorText }),
        { status: response.status, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Create unified SSE stream
    const sseStream = createUnifiedSSEStream(response, provider);

    return new Response(sseStream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'Access-Control-Allow-Origin': '*',
        'X-Provider': provider,
        'X-Model': selectedModel,
        'X-Tool-Categories': selectedCategories.join(','),
        'X-Tool-Count': String(finalTools.length),
      },
    });

  } catch (error) {
    console.error('Agentic loop error:', error);
    return new Response(
      JSON.stringify({
        error: 'Internal server error',
        message: error instanceof Error ? error.message : 'Unknown error',
      }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
});
