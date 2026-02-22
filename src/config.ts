// Copyright (c) 2026 Leonardo Boquillon <lboquillon at gmail dot com>
// Licensed under the MIT License. See LICENSE file for details.


function envInt(key: string, fallback: number): number {
  const raw = process.env[key];
  if (raw === undefined) return fallback;
  const n = parseInt(raw, 10);
  if (Number.isNaN(n)) {
    console.warn(`[config] invalid integer for ${key}="${raw}", using default ${fallback}`);
    return fallback;
  }
  return n;
}

function envFloat(key: string, fallback: number): number {
  const raw = process.env[key];
  if (raw === undefined) return fallback;
  const n = parseFloat(raw);
  if (Number.isNaN(n)) {
    console.warn(`[config] invalid float for ${key}="${raw}", using default ${fallback}`);
    return fallback;
  }
  return n;
}

export const PORT = envInt('BRB_PORT', 3000);
export const DATA_DIR = process.env.BRB_DATA_DIR || './data';
export const EMBED_URL = process.env.BRB_EMBED_URL || 'http://localhost:9090';
export const EXTRACT_URL = process.env.BRB_EXTRACT_URL || 'http://localhost:9091';
export const EMBED_DIM = envInt('BRB_EMBED_DIM', 768);
export const MAX_MEMORIES = envInt('BRB_MAX_MEMORIES', 10);
export const MIN_SCORE = envFloat('BRB_MIN_SCORE', 0.3);
export const MAX_MEMORY_TOKENS = envInt('BRB_MAX_MEMORY_TOKENS', 1500);
export const DEDUP_THRESHOLD = envFloat('BRB_DEDUP_THRESHOLD', 0.82);
export const MIN_SIMILARITY = envFloat('BRB_MIN_SIMILARITY', 0.30);
export const QUERY_REWRITE_ENABLED = process.env.BRB_NO_REWRITE !== 'true';
