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
 * - Automatic provider switching
 * - Token tracking
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';

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
  parameters: {
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
  style_instructions?: string;
  // Provider selection
  provider?: AIProvider;
  model?: string;
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
      console.log(`[WARN] Skipping duplicate tool: ${tool.name}`);
      continue;
    }
    seenNames.add(lowerName);
    anthropicTools.push({
      name: tool.name,
      description: tool.description,
      input_schema: {
        type: 'object',
        properties: tool.parameters.properties || {},
        required: tool.parameters.required || [],
      },
    });
  }

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
    functionDeclarations: tools.map(tool => ({
      name: tool.name,
      description: tool.description,
      parameters: {
        type: 'object',
        properties: tool.parameters.properties || {},
        required: tool.parameters.required || [],
      },
    })),
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
      style_instructions,
      provider = 'anthropic',
      model,
    } = body;

    // Determine model to use
    const selectedModel = model || PROVIDER_CONFIG[provider]?.defaultModel || PROVIDER_CONFIG.anthropic.defaultModel;

    // Build system prompt
    let systemPrompt = `You are Wilson, an AI assistant for cannabis retail stores. You help with inventory management, sales analysis, and store operations.

CRITICAL RULES - MUST FOLLOW:
1. NEVER call the same tool twice with the same parameters. If you already called analytics(query_type="summary"), DO NOT call it again.
2. After receiving tool results, STOP calling tools and write your response to the user.
3. Each tool call should have DIFFERENT parameters. For analytics: summary, trend, by_location are DIFFERENT. But calling summary twice is FORBIDDEN.
4. When you have data, summarize it. Don't fetch more of the same data.

Current store ID: ${store_id || 'unknown'}
Working directory: ${body.working_directory || 'unknown'}
Platform: ${body.platform || 'unknown'}

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
      response = await callAnthropic(messages, systemPrompt, local_tools, selectedModel, true);
    } else if (provider === 'gemini') {
      response = await callGemini(messages, systemPrompt, local_tools, selectedModel, true);
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
