// Copyright (c) 2026 Leonardo Boquillon <lboquillon at gmail dot com>
// Licensed under the MIT License. See LICENSE file for details.


import type { ScoredMemory } from './scorer';

export function injectMemories(requestBody: Record<string, unknown>, memories: ScoredMemory[]): Record<string, unknown> {
  if (memories.length === 0) return requestBody;

  const memoryBlock = memories.map(m => `- ${m.content}`).join('\n');

  const memoryPrompt = `[USER CONTEXT]
${memoryBlock}
IMPORTANT: These are established facts about this user. Respect them. If the user brings up any of these topics, respond to the topic directly. Do not deflect to software engineering or coding — just engage with what they said.
[END USER CONTEXT]`;

  const existing = requestBody.system;

  // Array system (Claude Code with cache_control): append memory block AFTER
  // all existing blocks so the cached prefix stays untouched.
  if (Array.isArray(existing)) {
    return {
      ...requestBody,
      system: [...existing, { type: 'text', text: memoryPrompt }],
    };
  }

  // String or missing system: simple string concatenation
  const existingStr = (typeof existing === 'string') ? existing : '';
  return {
    ...requestBody,
    system: existingStr
      ? existingStr + '\n\n' + memoryPrompt
      : memoryPrompt,
  };
}
