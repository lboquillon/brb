// Copyright (c) 2026 Leonardo Boquillon <lboquillon at gmail dot com>
// Licensed under the MIT License. See LICENSE file for details.


import { memoryStore } from '../storage/zvec';
import { DEDUP_THRESHOLD } from '../config';
import { createLogger } from '../lib/logger';

const log = createLogger('dedup');

export interface DedupResult {
  action: 'insert' | 'merge';
  id: string;
  mergedWith?: string;
}

export async function dedupAndStore(
  content: string,
  category: string,
  confidence: number,
  embedding: number[],
): Promise<DedupResult> {
  const now = new Date().toISOString();
  const neighbors = memoryStore.search(embedding, 5);

  if (neighbors.length > 0) {
    const top = neighbors[0];
    log.debug(`checking "${content}" — top neighbor: "${top.fields.content}" (sim=${top.score.toFixed(3)})`);
  }

  for (const neighbor of neighbors) {
    const existing = neighbor.fields;

    // Exact content match — always merge regardless of embedding similarity
    if (existing.content === content) {
      const newMentions = (existing.mentions ?? 1) + 1;
      memoryStore.upsert({
        id: neighbor.id,
        vectors: { embedding },
        fields: {
          content,
          category,
          strength: 1.0,
          mentions: newMentions,
          last_reinforced: now,
          confidence: Math.max(confidence, existing.confidence),
          created_at: existing.created_at,
          last_accessed: now,
          archived: existing.archived,
          archive_reason: existing.archive_reason,
        },
      });
      log.debug(`exact match → merged into ${neighbor.id} (mentions=${newMentions})`);
      return { action: 'merge', id: neighbor.id, mergedWith: neighbor.id };
    }

    // Embedding similarity above threshold — same topic, merge with newer content
    if (neighbor.score >= DEDUP_THRESHOLD) {
      const newMentions = (existing.mentions ?? 1) + 1;
      memoryStore.upsert({
        id: neighbor.id,
        vectors: { embedding },
        fields: {
          content,
          category,
          strength: 1.0,
          mentions: newMentions,
          last_reinforced: now,
          confidence: Math.max(confidence, existing.confidence),
          created_at: existing.created_at,
          last_accessed: now,
          archived: existing.archived,
          archive_reason: existing.archive_reason,
        },
      });
      log.debug(`sim=${neighbor.score.toFixed(3)} → merged into ${neighbor.id}: "${existing.content}" → "${content}" (mentions=${newMentions})`);
      return { action: 'merge', id: neighbor.id, mergedWith: neighbor.id };
    }
  }

  // No near-duplicate — insert new
  const id = crypto.randomUUID();
  memoryStore.insert({
    id,
    embedding,
    content,
    category,
    confidence,
    strength: 1.0,
    mentions: 1,
    last_reinforced: now,
    created_at: now,
    last_accessed: now,
    archived: 'false',
    archive_reason: '',
  });

  log.debug(`inserted new ${id} (category=${category})`);
  return { action: 'insert', id };
}
