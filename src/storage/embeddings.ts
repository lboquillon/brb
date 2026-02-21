// Copyright (c) 2026 Leonardo Boquillon <lboquillon at gmail dot com>
// Licensed under the MIT License. See LICENSE file for details.


import { EmbedClient, LLMClient } from '../lib/llm-client';
import { EMBED_URL, EXTRACT_URL } from '../config';

export const embedClient = new EmbedClient({ url: EMBED_URL });
export const llmClient = new LLMClient({ url: EXTRACT_URL, timeoutMs: 120_000 });

// nomic-embed-text requires task prefixes for aligned embeddings:
// "search_document: " for text being stored, "search_query: " for search queries.
// Without these, cosine similarity scores are near-random.
export const embedDocument = (text: string) => embedClient.embed(`search_document: ${text}`);
export const embedQuery = (text: string) => embedClient.embed(`search_query: ${text}`);

// Cached health check — checks both servers, caches for 60s
// Uses a pending promise to coalesce concurrent callers (prevents stampede)
let _healthy = true;
let _lastCheck = 0;
let _pending: Promise<boolean> | null = null;

export async function llamacppIsHealthy(): Promise<boolean> {
  if (Date.now() - _lastCheck < 60_000) return _healthy;

  // If a check is already in flight, join it instead of starting another
  if (_pending) return _pending;

  _pending = (async () => {
    try {
      const [eOk, lOk] = await Promise.all([
        embedClient.healthy(),
        llmClient.healthy(),
      ]);
      _healthy = eOk && lOk;
      _lastCheck = Date.now();
      return _healthy;
    } finally {
      _pending = null;
    }
  })();

  return _pending;
}
