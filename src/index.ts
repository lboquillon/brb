// Copyright (c) 2026 Leonardo Boquillon <lboquillon at gmail dot com>
// Licensed under the MIT License. See LICENSE file for details.


import { createServer } from 'node:http';
import { route } from './router';
import { HttpError } from './lib/errors';
import { PORT, DATA_DIR } from './config';
import { memoryStore } from './storage/zvec';
import { checkpointLog } from './storage/checkpoints';
import { extractAndStore } from './extraction/extractor';
import { queue } from './queue';
import { startSessionWatcher } from './storage/sessions';
import { llamacppIsHealthy } from './storage/embeddings';
import { createLogger } from './lib/logger';

const log = createLogger('brb');

// 1. Initialize zvec memory store — abort on failure
try {
  memoryStore.init(DATA_DIR);
  const { docCount, indexCompleteness } = memoryStore.stats;
  log.info(`zvec memory store initialized (${docCount} memories, indexCompleteness=${JSON.stringify(indexCompleteness)})`);

  // Detect corrupt HNSW index: documents exist but index is empty
  if (docCount > 0 && indexCompleteness?.embedding === 0) {
    log.warn('HNSW index is broken (indexCompleteness=0). Attempting optimize...');
    try {
      memoryStore.optimize();
      log.info('optimize succeeded — index rebuilt');
    } catch {
      log.warn('optimize failed — destroying and recreating collection');
      memoryStore.destroy(DATA_DIR);
      memoryStore.init(DATA_DIR);
      log.info('clean collection created — memories will be rebuilt from checkpoints');
    }
  }
} catch (err) {
  log.error('Failed to init memory store:', err);
  process.exit(1);
}

// 2. Create server
const server = createServer(async (req, res) => {
  try {
    await route(req, res);
  } catch (err: unknown) {
    const statusCode = err instanceof HttpError ? err.statusCode : 500;
    const message = err instanceof Error ? err.message : 'Internal server error';
    log.error('Unhandled:', err);
    if (!res.headersSent) {
      res.writeHead(statusCode, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: message }));
    }
  }
});

const ac = new AbortController();

// 3. Recover orphaned checkpoints (fire and forget)
async function recoverOrphanedCheckpoints() {
  try {
    const orphans = await checkpointLog.getUnextracted();
    if (orphans.length === 0) return;
    log.info(`recovering ${orphans.length} orphaned checkpoints`);
    for (const cp of orphans) {
      queue.add(() => extractAndStore(
        cp.user_input, cp.assistant_output, cp.session_id, cp.id
      ));
    }
  } catch (err) {
    log.error('checkpoint recovery failed:', err);
  }
}

// 4. Start session watcher (evict inactive sessions every 5min)
const sessionInterval = startSessionWatcher();

// 5. Start server — bind to localhost only
server.listen({ port: PORT, host: '127.0.0.1', signal: ac.signal }, async () => {
  log.info(`running on http://127.0.0.1:${PORT}`);

  // Check llama.cpp status on startup
  const healthy = await llamacppIsHealthy();
  if (healthy) {
    log.info('llama.cpp servers healthy (embed + extract)');
  } else {
    log.warn('llama.cpp servers not available — running in passthrough mode');
  }

  // Recover orphaned checkpoints after server is listening
  recoverOrphanedCheckpoints();
});

// Graceful shutdown
for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sig, () => {
    log.info(`${sig} received, shutting down...`);
    clearInterval(sessionInterval);
    ac.abort();
    memoryStore.close();
    process.exit(0);
  });
}
