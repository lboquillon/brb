// Copyright (c) 2026 Leonardo Boquillon <lboquillon at gmail dot com>
// Licensed under the MIT License. See LICENSE file for details.


import { memoryStore } from '../storage/zvec';
import { embedQuery, llamacppIsHealthy } from '../storage/embeddings';
import { QUERY_REWRITE_ENABLED } from '../config';
import { rewriteQuery } from './queryRewriter';
import { scoreAndRank, type ScoredMemory, type RawCandidate } from './scorer';

interface ContentBlock {
  type: string;
  text?: string;
}

interface Message {
  role: string;
  content: string | ContentBlock[];
}

export async function searchMemories(
  userMessage: string,
  messages: Message[],
): Promise<ScoredMemory[]> {
  try {
    if (!await llamacppIsHealthy()) {
      return [];
    }

    // Step 1: Query rewrite (optional)
    const searchQuery = QUERY_REWRITE_ENABLED
      ? await rewriteQuery(userMessage, messages)
      : userMessage;

    if (searchQuery !== userMessage) {
      console.log(`[retrieval] rewritten: "${userMessage.slice(0, 60)}" → "${searchQuery}"`);
    }

    // Step 2: Embed the query
    const queryVector = await embedQuery(searchQuery);

    // Step 3: zvec hybrid search — 30 candidates, exclude archived
    // zvec returns Record<string, any> fields — cast at boundary
    const candidates = memoryStore.search(queryVector, 30) as unknown as RawCandidate[];

    if (candidates.length === 0) return [];

    // Step 4: Composite scoring, filter, rank, cut to top 10
    const scored = scoreAndRank(candidates);

    // Step 5: Touch last_accessed on returned memories
    const now = new Date().toISOString();
    for (const mem of scored) {
      try {
        memoryStore.update(mem.id, { last_accessed: now });
      } catch { /* non-fatal */ }
    }

    return scored;
  } catch (err) {
    console.error('[retrieval] search failed:', err);
    return [];
  }
}
