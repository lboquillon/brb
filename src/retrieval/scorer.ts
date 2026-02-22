// Copyright (c) 2026 Leonardo Boquillon <lboquillon at gmail dot com>
// Licensed under the MIT License. See LICENSE file for details.


import { MIN_SCORE, MIN_SIMILARITY, MAX_MEMORIES } from '../config';
import type { SearchResult } from '../storage/zvec';

export interface ScoredMemory {
  id: string;
  content: string;
  category: string;
  similarity: number;
  finalScore: number;
}

export type RawCandidate = SearchResult;

const MENTIONS_SATURATION = 15;
const DECAY_RATE = 0.009;
const RECENCY_HALF_LIFE = 140;
const CONFIDENCE_BONUS = 0.05;

function daysSince(isoDate: string): number {
  const ms = Date.now() - new Date(isoDate).getTime();
  return Math.max(0, ms / (1000 * 60 * 60 * 24));
}

export function scoreCandidate(candidate: RawCandidate): ScoredMemory {
  const f = candidate.fields;
  const sim = candidate.score;

  // Similarity gate — low-similarity garbage cannot be rescued by temporal signals
  if (sim < MIN_SIMILARITY) {
    return {
      id: candidate.id,
      content: f.content,
      category: f.category,
      similarity: sim,
      finalScore: 0.0,
    };
  }

  const mentions = f.mentions;
  const confidence = f.confidence;
  const lastReinforced = f.last_reinforced;
  const lastAccessed = f.last_accessed;

  const strengthNorm = Math.min(1.0, mentions / MENTIONS_SATURATION);
  const strengthDecay = strengthNorm * Math.exp(-DECAY_RATE * daysSince(lastReinforced));
  const recency = Math.exp(-Math.LN2 / RECENCY_HALF_LIFE * daysSince(lastAccessed));
  const temporal = 0.65 * strengthDecay + 0.35 * recency;

  const finalScore = sim * (0.68 + 0.32 * temporal) + CONFIDENCE_BONUS * confidence;

  return {
    id: candidate.id,
    content: f.content,
    category: f.category,
    similarity: sim,
    finalScore,
  };
}

export function scoreAndRank(candidates: RawCandidate[]): ScoredMemory[] {
  return candidates
    .map(scoreCandidate)
    .filter(m => m.finalScore >= MIN_SCORE)
    .sort((a, b) => b.finalScore - a.finalScore)
    .slice(0, MAX_MEMORIES);
}
