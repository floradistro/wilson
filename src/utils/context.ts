/**
 * Context Management - Claude Code style
 *
 * Handles conversation compaction and tool result clearing
 * to maximize effective use of the 200k token context window.
 */

import { log } from './logger.js';

// =============================================================================
// Types
// =============================================================================

interface TextBlock {
  type: 'text';
  text: string;
}

interface ToolUseBlock {
  type: 'tool_use';
  id: string;
  name: string;
  input: Record<string, unknown>;
}

interface ToolResultBlock {
  type: 'tool_result';
  tool_use_id: string;
  content: string;
}

type ContentBlock = TextBlock | ToolUseBlock | ToolResultBlock | string;

interface Message {
  role: string;
  content: string | ContentBlock[];
}

// =============================================================================
// Token Estimation
// =============================================================================

// Rough token estimation (4 chars ≈ 1 token)
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

function estimateMessageTokens(msg: Message): number {
  if (typeof msg.content === 'string') {
    return estimateTokens(msg.content);
  }
  if (Array.isArray(msg.content)) {
    return msg.content.reduce((sum, block) => {
      if (typeof block === 'string') return sum + estimateTokens(block);
      if (block.type === 'text') return sum + estimateTokens(block.text || '');
      if (block.type === 'tool_use') return sum + estimateTokens(JSON.stringify(block.input || {})) + 50;
      if (block.type === 'tool_result') return sum + estimateTokens(block.content || '') + 20;
      return sum + 100; // Default for unknown blocks
    }, 0);
  }
  return estimateTokens(JSON.stringify(msg.content));
}

export function estimateConversationTokens(messages: Message[]): number {
  return messages.reduce((sum, msg) => sum + estimateMessageTokens(msg), 0);
}

// =============================================================================
// Constants
// =============================================================================

const MAX_CONTEXT_TOKENS = 200000;      // 200k context window
const COMPACTION_THRESHOLD = 0.80;       // Claude Code: 80%
const RECENT_MESSAGES_TO_KEEP = 8;       // Keep recent context intact

// =============================================================================
// Compaction
// =============================================================================

interface CompactionResult {
  messages: Message[];
  wasCompacted: boolean;
  tokensBefore: number;
  tokensAfter: number;
}

/**
 * Compact conversation history when approaching context limit.
 *
 * Strategy (matching Claude Code):
 * 1. Keep system context intact
 * 2. Keep most recent messages intact
 * 3. Clear tool results from older messages (replace with placeholder)
 * 4. If still too large, summarize old messages
 */
export function compactConversation(
  messages: Message[],
  options: {
    threshold?: number;
    keepRecent?: number;
  } = {}
): CompactionResult {
  const {
    threshold = COMPACTION_THRESHOLD,
    keepRecent = RECENT_MESSAGES_TO_KEEP,
  } = options;

  const tokensBefore = estimateConversationTokens(messages);
  const thresholdTokens = MAX_CONTEXT_TOKENS * threshold;

  // No compaction needed
  if (tokensBefore < thresholdTokens) {
    return { messages, wasCompacted: false, tokensBefore, tokensAfter: tokensBefore };
  }

  log.info(`Compacting conversation: ${tokensBefore} tokens > ${thresholdTokens} threshold`);

  // Split into old and recent
  const splitPoint = Math.max(0, messages.length - keepRecent);
  const oldMessages = messages.slice(0, splitPoint);
  const recentMessages = messages.slice(splitPoint);

  // First pass: Clear tool results from old messages
  const clearedOld = clearToolResults(oldMessages);
  let compacted = [...clearedOld, ...recentMessages];
  let tokensAfter = estimateConversationTokens(compacted);

  // If still too large, summarize old messages
  if (tokensAfter > thresholdTokens && clearedOld.length > 0) {
    const summary = summarizeMessages(clearedOld);
    compacted = [
      { role: 'user', content: `[Previous conversation summary]\n${summary}` },
      { role: 'assistant', content: 'I understand. Continuing from where we left off.' },
      ...recentMessages,
    ];
    tokensAfter = estimateConversationTokens(compacted);
  }

  log.info(`Compacted: ${tokensBefore} → ${tokensAfter} tokens`);

  return {
    messages: compacted,
    wasCompacted: true,
    tokensBefore,
    tokensAfter,
  };
}

/**
 * Clear tool results from messages, replacing with placeholder.
 * This preserves the conversation flow while reducing tokens.
 */
function clearToolResults(messages: Message[]): Message[] {
  return messages.map(msg => {
    if (!Array.isArray(msg.content)) return msg;

    const clearedContent = msg.content.map((block): ContentBlock => {
      if (typeof block === 'string') return block;

      // Clear tool_result content
      if (block.type === 'tool_result') {
        return {
          ...block,
          content: '[Result cleared to save context]',
        };
      }

      // Clear large tool_use inputs
      if (block.type === 'tool_use' && block.input) {
        const inputSize = JSON.stringify(block.input).length;
        if (inputSize > 1000) {
          return {
            ...block,
            input: { _cleared: true, _original_size: inputSize },
          };
        }
      }

      return block;
    });

    return { ...msg, content: clearedContent };
  });
}

/**
 * Create a summary of messages for extreme compaction.
 */
function summarizeMessages(messages: Message[]): string {
  const lines: string[] = [];

  for (const msg of messages) {
    if (msg.role === 'user') {
      const text = extractText(msg.content);
      if (text && !text.startsWith('[')) {
        lines.push(`User: ${text.slice(0, 200)}${text.length > 200 ? '...' : ''}`);
      }
    } else if (msg.role === 'assistant') {
      // Extract tool names used
      const tools = extractToolNames(msg.content);
      if (tools.length > 0) {
        lines.push(`Assistant: Used tools: ${tools.join(', ')}`);
      } else {
        const text = extractText(msg.content);
        if (text) {
          lines.push(`Assistant: ${text.slice(0, 100)}${text.length > 100 ? '...' : ''}`);
        }
      }
    }
  }

  return lines.slice(0, 20).join('\n'); // Max 20 lines
}

function extractText(content: string | ContentBlock[]): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    for (const block of content) {
      if (typeof block === 'string') return block;
      if (block.type === 'text' && block.text) return block.text;
    }
  }
  return '';
}

function extractToolNames(content: string | ContentBlock[]): string[] {
  if (!Array.isArray(content)) return [];
  return content
    .filter((block): block is ToolUseBlock => typeof block !== 'string' && block.type === 'tool_use')
    .map(block => block.name)
    .filter(Boolean);
}

/**
 * Get context usage info for display
 */
export function getContextUsage(messages: Message[]): {
  tokens: number;
  percentage: number;
  status: 'ok' | 'warning' | 'critical';
} {
  const tokens = estimateConversationTokens(messages);
  const percentage = (tokens / MAX_CONTEXT_TOKENS) * 100;

  let status: 'ok' | 'warning' | 'critical' = 'ok';
  if (percentage > 90) status = 'critical';
  else if (percentage > 75) status = 'warning';

  return { tokens, percentage, status };
}
