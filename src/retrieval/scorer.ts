// Copyright (c) 2026 Leonardo Boquillon <lboquillon at gmail dot com>
// Licensed under the MIT License. See LICENSE file for details.


import { MIN_SCORE, MIN_SIMILARITY, MAX_MEMORIES } from '../config';

export interface ScoredMemory {
  id: string;
  content: string;
  category: string;
  similarity: number;
  finalScore: number;
}

export interface MemoryFields {
  content: string;
  category: string;
  confidence: number;
  strength: number;
  created_at: string;
  last_accessed: string;
  archived: string;
  archive_reason: string;
  [key: string]: unknown; // allow extra fields from zvec
}

export interface RawCandidate {
  id: string;
  score: number;
  fields: MemoryFields;
}

const SIMILARITY_WEIGHT = 0.55;
const STRENGTH_DECAY_WEIGHT = 0.25;
const RECENCY_WEIGHT = 0.15;
const CONFIDENCE_WEIGHT = 0.05;

const DECAY_RATE = 0.01;
const RECENCY_RATE = 0.005;

function daysSince(isoDate: string): number {
  const ms = Date.now() - new Date(isoDate).getTime();
  return Math.max(0, ms / (1000 * 60 * 60 * 24));
}

export function scoreCandidate(candidate: RawCandidate): ScoredMemory {
  const f = candidate.fields;
  const similarity = candidate.score;
  const strength = f.strength ?? 1.0;
  const confidence = f.confidence ?? 0.5;
  const createdAt = f.created_at ?? new Date().toISOString();
  const lastAccessed = f.last_accessed ?? createdAt;

  const decay = Math.exp(-DECAY_RATE * daysSince(createdAt));
  const recency = Math.exp(-RECENCY_RATE * daysSince(lastAccessed));

  const finalScore =
    (similarity * SIMILARITY_WEIGHT) +
    (strength * decay * STRENGTH_DECAY_WEIGHT) +
    (recency * RECENCY_WEIGHT) +
    (confidence * CONFIDENCE_WEIGHT);

  return {
    id: candidate.id,
    content: f.content,
    category: f.category,
    similarity,
    finalScore,
  };
}

export function scoreAndRank(candidates: RawCandidate[]): ScoredMemory[] {
  return candidates
    .map(scoreCandidate)
    .filter(m => m.similarity >= MIN_SIMILARITY && m.finalScore >= MIN_SCORE)
    .sort((a, b) => b.finalScore - a.finalScore)
    .slice(0, MAX_MEMORIES);
}
