// Copyright (c) 2026 Leonardo Boquillon <lboquillon at gmail dot com>
// Licensed under the MIT License. See LICENSE file for details.


import { IncomingMessage, ServerResponse } from 'node:http';
import { chatHandler } from './proxy/chatHandler';
import { memoryStore } from './storage/zvec';
import { embedQuery, llamacppIsHealthy } from './storage/embeddings';
import { queue } from './queue';
import { HttpError } from './lib/errors';
import { createLogger } from './lib/logger';

const log = createLogger('router');

async function readBody(req: IncomingMessage, maxBytes = 10_000_000): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > maxBytes) throw new HttpError(413, 'Payload too large');
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString()) as Record<string, unknown>;
  } catch {
    throw new HttpError(400, 'Invalid JSON');
  }
}

function json(res: ServerResponse, data: unknown, status = 200) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data, null, 2));
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function route(req: IncomingMessage, res: ServerResponse) {
  const url = new URL(req.url || '/', `http://${req.headers.host}`);
  const path = url.pathname;
  const method = req.method || 'GET';

  // Main proxy route
  if (method === 'POST' && path === '/v1/messages') {
    const body = await readBody(req);
    return chatHandler(body, req, res);
  }

  // Health check
  if (method === 'GET' && path === '/health') {
    const healthy = await llamacppIsHealthy();
    return json(res, {
      proxy: 'ok',
      llama: healthy ? 'ok' : 'down',
      memories: memoryStore.stats.docCount,
      queue: queue.pending,
      uptime: process.uptime(),
    });
  }

  // List all memories (with pagination)
  if (method === 'GET' && path === '/memories') {
    const limit = Math.min(Math.max(parseInt(url.searchParams.get('limit') || '100', 10) || 100, 1), 1000);
    const offset = Math.max(parseInt(url.searchParams.get('offset') || '0', 10) || 0, 0);

    const all = memoryStore.filterOnly("archived = 'false'");
    const total = all.length;
    const page = all.slice(offset, offset + limit);
    const memories = page.map((m) => ({
      id: m.id,
      content: m.fields.content,
      category: m.fields.category,
      confidence: m.fields.confidence,
      strength: m.fields.strength,
      mentions: m.fields.mentions,
      last_reinforced: m.fields.last_reinforced,
      created_at: m.fields.created_at,
      last_accessed: m.fields.last_accessed,
    }));
    return json(res, { total, count: memories.length, offset, limit, memories });
  }

  // Search memories by query
  if (method === 'GET' && path === '/memories/search') {
    const q = url.searchParams.get('q');
    if (!q) return json(res, { error: 'Missing ?q= parameter' }, 400);

    let vector: number[];
    try {
      vector = await embedQuery(q);
    } catch (err) {
      log.error('embed failed for search:', err);
      return json(res, { error: 'Embedding service unavailable' }, 503);
    }

    const results = memoryStore.search(vector, 10);
    const memories = results.map((r) => ({
      id: r.id,
      score: r.score,
      content: r.fields.content,
      category: r.fields.category,
      strength: r.fields.strength,
      mentions: r.fields.mentions,
      last_reinforced: r.fields.last_reinforced,
    }));
    return json(res, { query: q, count: memories.length, memories });
  }

  // Delete a memory
  if (method === 'DELETE' && path.startsWith('/memories/')) {
    const id = path.slice('/memories/'.length);
    if (!UUID_RE.test(id)) {
      return json(res, { error: 'Invalid memory ID' }, 400);
    }
    memoryStore.delete(id);
    return json(res, { deleted: id });
  }

  json(res, { error: 'Not found' }, 404);
}
