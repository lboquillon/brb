// Copyright (c) 2026 Leonardo Boquillon <lboquillon at gmail dot com>
// Licensed under the MIT License. See LICENSE file for details.


import type { ScoredMemory } from './scorer';
import { MAX_MEMORY_TOKENS } from '../config';

/** Conservative BPE token estimate (~4 chars per token for English). */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

const BRACKET_MARKER_RE = /\[(?:[A-Z][A-Z _]*)\]/g;
const CONTROL_CHAR_RE = /[\x00-\x08\x0b\x0c\x0e-\x1f]/g;
const MAX_MEMORY_LENGTH = 500;

/** Strip dangerous patterns from memory content before injection. */
export function sanitizeContent(content: string): string {
  let s = content;
  // Strip bracket markers like [USER CONTEXT], [END USER CONTEXT], [SYSTEM], etc.
  s = s.replace(BRACKET_MARKER_RE, '');
  // Collapse newlines and carriage returns to single spaces
  s = s.replace(/[\r\n]+/g, ' ');
  // Strip control characters (U+0000-U+001F except tab/newline/cr which are already handled)
  s = s.replace(CONTROL_CHAR_RE, '');
  // Collapse any resulting multiple spaces
  s = s.replace(/ {2,}/g, ' ').trim();
  // Truncate to max length
  if (s.length > MAX_MEMORY_LENGTH) s = s.slice(0, MAX_MEMORY_LENGTH);
  return s;
}

const HEADER = '[USER CONTEXT]\n';
const FOOTER = '\n[END USER CONTEXT]';
const INSTRUCTION = 'You are also this user\'s personal assistant. You know them personally. When they talk about personal topics — preferences, food, life, opinions — respond as a friend who knows them, not as a coding tool. No redirecting to code. No "let me know if there\'s anything I can help you build." Just talk to them.';

/** Always-injected instruction. When memories exist, includes the context block too. */
export function injectMemories(requestBody: Record<string, unknown>, memories: ScoredMemory[]): Record<string, unknown> {
  let prompt: string;

  if (memories.length === 0) {
    // No memories yet — still inject the behavioral instruction
    prompt = INSTRUCTION;
  } else {
    // Budget: tokens available for the memory block
    const budget = MAX_MEMORY_TOKENS;
    const overhead = estimateTokens(HEADER) + estimateTokens(FOOTER) + estimateTokens(INSTRUCTION);

    let usedTokens = overhead;
    const accepted: string[] = [];

    // memories arrive sorted by finalScore descending (from scoreAndRank)
    for (const m of memories) {
      const sanitized = sanitizeContent(m.content);
      if (sanitized.length === 0) continue;
      const line = `- ${sanitized}\n`;
      const lineTokens = estimateTokens(line);
      if (usedTokens + lineTokens > budget) break;
      usedTokens += lineTokens;
      accepted.push(sanitized);
    }

    if (accepted.length === 0) {
      prompt = INSTRUCTION;
    } else {
      const memoryBlock = accepted.map(c => `- ${c}`).join('\n');
      prompt = `${HEADER}${memoryBlock}${FOOTER}\n${INSTRUCTION}`;
    }
  }

  const existing = requestBody.system;

  // Array system (Claude Code with cache_control): append AFTER
  // all existing blocks so the cached prefix stays untouched.
  if (Array.isArray(existing)) {
    return {
      ...requestBody,
      system: [...existing, { type: 'text', text: prompt }],
    };
  }

  // String or missing system: simple string concatenation
  const existingStr = (typeof existing === 'string') ? existing : '';
  return {
    ...requestBody,
    system: existingStr
      ? existingStr + '\n\n' + prompt
      : prompt,
  };
}
