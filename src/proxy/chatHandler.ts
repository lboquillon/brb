// Copyright (c) 2026 Leonardo Boquillon <lboquillon at gmail dot com>
// Licensed under the MIT License. See LICENSE file for details.


import { IncomingMessage, ServerResponse } from 'node:http';
import { forwardToClaudeStreaming, forwardToClaudeNormal } from './claudeClient';
import { searchMemories } from '../retrieval/engine';
import { injectMemories } from '../retrieval/injector';
import { llamacppIsHealthy } from '../storage/embeddings';
import { checkpointLog } from '../storage/checkpoints';
import { extractAndStore } from '../extraction/extractor';
import { queue } from '../queue';
import { touchSession } from '../storage/sessions';

interface ContentBlock {
  type: string;
  text?: string;
}

interface Message {
  role: string;
  content: string | ContentBlock[];
}

const SESSION_ID_RE = /^[a-zA-Z0-9_.-]{1,128}$/;

// Patterns injected by Claude Code / clients that are not actual user input
const SYSTEM_NOISE = [
  '<system-reminder>',
  '[SUGGESTION MODE:',
  '<command-name>',
  '<fast_mode_info>',
];

function isSystemNoise(text: string): boolean {
  const trimmed = text.trimStart();
  return SYSTEM_NOISE.some(prefix => trimmed.startsWith(prefix));
}

/** Extract real user text, filtering out system-injected content */
function extractUserText(content: string | ContentBlock[] | undefined): string {
  if (typeof content === 'string') {
    return isSystemNoise(content) ? '' : content;
  }
  if (Array.isArray(content)) {
    return content
      .filter((b) => b.type === 'text' && b.text && !isSystemNoise(b.text))
      .map((b) => b.text!)
      .join('\n');
  }
  return '';
}

export async function chatHandler(
  body: Record<string, unknown>,
  req: IncomingMessage,
  res: ServerResponse
) {
  const messages = (body.messages || []) as Message[];
  let latestUserMessage: Message | undefined;
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === 'user') { latestUserMessage = messages[i]; break; }
  }

  const rawSessionId = req.headers['x-session-id'];
  const sessionHeader = Array.isArray(rawSessionId) ? rawSessionId[0] : rawSessionId;
  const sessionId = (sessionHeader && SESSION_ID_RE.test(sessionHeader))
    ? sessionHeader
    : 'default';

  const userText = extractUserText(latestUserMessage?.content);

  touchSession(sessionId);

  // 1. Retrieve + inject (skip if llama.cpp down, no user message, or trivial input)
  const worthSearching = userText && userText.trim().split(/\s+/).length >= 2;
  let enrichedBody: Record<string, unknown> = body;
  if (worthSearching && await llamacppIsHealthy()) {
    try {
      const memories = await searchMemories(userText, messages);
      if (memories.length > 0) {
        console.log(`[chatHandler] injecting ${memories.length} memories:`);
        for (const m of memories) {
          console.log(`  [${m.category}] (score=${m.finalScore.toFixed(3)}, sim=${m.similarity.toFixed(3)}) ${m.content}`);
        }
      } else {
        console.log(`[chatHandler] no memories found for: "${userText.slice(0, 80)}"`);
      }
      enrichedBody = injectMemories(body, memories);
      if (process.env.BRB_DEBUG) {
        const sys = enrichedBody.system;
        console.log('[chatHandler] system type after inject:', Array.isArray(sys) ? `array[${(sys as unknown[]).length}]` : typeof sys);
      }
    } catch (err) {
      console.error('[chatHandler] retrieval failed, forwarding without memories:', err);
    }
  }

  // 2. Forward to Claude
  const isStreaming = body.stream === true;
  const fullResponse = isStreaming
    ? await forwardToClaudeStreaming(enrichedBody, req, res)
    : await forwardToClaudeNormal(enrichedBody, req, res);

  // 3. Checkpoint + extraction (fire and forget)
  if (userText && fullResponse) {
    try {
      const cpId = await checkpointLog.save(sessionId, userText, fullResponse);
      queue.add(() => extractAndStore(
        userText, fullResponse, sessionId, cpId
      ));
    } catch (err) {
      console.error('[chatHandler] checkpoint/extraction queue failed:', err);
    }
  }
}
