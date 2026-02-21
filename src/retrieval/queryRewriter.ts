// Copyright (c) 2026 Leonardo Boquillon <lboquillon at gmail dot com>
// Licensed under the MIT License. See LICENSE file for details.


import { llmClient } from '../storage/embeddings';

const SYSTEM_PROMPT =
  'You write short search queries. Given a conversation, output one search query (max 10 words) to find relevant memories. Output only the query, nothing else.';

interface ContentBlock {
  type: string;
  text?: string;
}

function textOf(content: string | ContentBlock[] | undefined): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content))
    return content.filter((b) => b.type === 'text').map((b) => b.text ?? '').join('\n');
  return '';
}

interface Message {
  role: string;
  content: string | ContentBlock[];
}

// Short, explicit messages don't benefit from rewriting — the raw text
// is already a good search query. Rewriting only helps vague references
// like "where were we on that thing?" that need conversation context.
const MAX_RAW_LENGTH = 120;

// Vague messages should always be rewritten regardless of length (Lesson 6).
const VAGUE_PATTERNS = /\b(that thing|this thing|that stuff|what was|where were|where did|how did|the thing|remind me|what about|were we)\b/i;

export async function rewriteQuery(
  userMessage: string,
  recentMessages: Message[],
): Promise<string> {
  // Short explicit messages: use as-is, no LLM call needed.
  // But vague messages always need rewriting even when short.
  if (userMessage.length <= MAX_RAW_LENGTH && !VAGUE_PATTERNS.test(userMessage)) {
    return userMessage;
  }

  const context = recentMessages
    .slice(-5)
    .map(m => `${m.role}: ${textOf(m.content)}`)
    .join('\n');

  try {
    const query = await llmClient.chat([
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: context },
    ], { temperature: 0.1, maxTokens: 50 });

    const trimmed = query.trim();
    if (trimmed.length === 0 || trimmed.length > 200) {
      return userMessage;
    }
    return trimmed;
  } catch (err) {
    console.error('[rewrite] query rewrite failed, using raw message:', err);
    return userMessage;
  }
}
