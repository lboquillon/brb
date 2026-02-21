// Copyright (c) 2026 Leonardo Boquillon <lboquillon at gmail dot com>
// Licensed under the MIT License. See LICENSE file for details.


import { memoryStore } from '../storage/zvec';
import { DEDUP_THRESHOLD } from '../config';

export interface DedupResult {
  action: 'insert' | 'merge';
  id: string;
  mergedWith?: string;
}

interface NeighborFields {
  content: string;
  strength: number;
  confidence: number;
  created_at: string;
  archived: string;
  archive_reason: string;
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
    const topFields = top.fields as NeighborFields;
    console.log(`[dedup] checking "${content}" — top neighbor: "${topFields.content}" (sim=${top.score.toFixed(3)})`);
  }

  for (const neighbor of neighbors) {
    const existing = neighbor.fields as NeighborFields;

    // Exact content match — always merge regardless of embedding similarity
    if (existing.content === content) {
      const newStrength = Math.min(existing.strength + 0.1, 1.0);
      memoryStore.upsert({
        id: neighbor.id,
        vectors: { embedding },
        fields: {
          content,
          category,
          strength: newStrength,
          confidence: Math.max(confidence, existing.confidence),
          created_at: existing.created_at,
          last_accessed: now,
          archived: existing.archived,
          archive_reason: existing.archive_reason,
        },
      });
      console.log(`[dedup] exact match → merged into ${neighbor.id} (strength=${newStrength})`);
      return { action: 'merge', id: neighbor.id, mergedWith: neighbor.id };
    }

    // Embedding similarity above threshold — same topic, merge with newer content
    if (neighbor.score >= DEDUP_THRESHOLD) {
      const newStrength = Math.min(existing.strength + 0.1, 1.0);
      memoryStore.upsert({
        id: neighbor.id,
        vectors: { embedding },
        fields: {
          content,
          category,
          strength: newStrength,
          confidence: Math.max(confidence, existing.confidence),
          created_at: existing.created_at,
          last_accessed: now,
          archived: existing.archived,
          archive_reason: existing.archive_reason,
        },
      });
      console.log(`[dedup] sim=${neighbor.score.toFixed(3)} → merged into ${neighbor.id}: "${existing.content}" → "${content}"`);
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
    created_at: now,
    last_accessed: now,
    archived: 'false',
    archive_reason: '',
  });

  console.log(`[dedup] inserted new ${id} (category=${category})`);
  return { action: 'insert', id };
}
