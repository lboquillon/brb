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

// 1. Initialize zvec memory store — abort on failure
try {
  memoryStore.init(DATA_DIR);
  console.log(`[brb] zvec memory store initialized (${memoryStore.stats.docCount} memories)`);
} catch (err) {
  console.error('[brb] Failed to init memory store:', err);
  process.exit(1);
}

// 2. Create server
const server = createServer(async (req, res) => {
  try {
    await route(req, res);
  } catch (err: unknown) {
    const statusCode = err instanceof HttpError ? err.statusCode : 500;
    const message = err instanceof Error ? err.message : 'Internal server error';
    console.error('[brb] Unhandled:', err);
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
    console.log(`[brb] recovering ${orphans.length} orphaned checkpoints`);
    for (const cp of orphans) {
      queue.add(() => extractAndStore(
        cp.user_input, cp.assistant_output, cp.session_id, cp.id
      ));
    }
  } catch (err) {
    console.error('[brb] checkpoint recovery failed:', err);
  }
}

// 4. Start session watcher (evict inactive sessions every 5min)
const sessionInterval = startSessionWatcher();

// 5. Start server — bind to localhost only
server.listen({ port: PORT, host: '127.0.0.1', signal: ac.signal }, async () => {
  console.log(`[brb] running on http://127.0.0.1:${PORT}`);

  // Check llama.cpp status on startup
  const healthy = await llamacppIsHealthy();
  if (healthy) {
    console.log('[brb] llama.cpp servers healthy (embed + extract)');
  } else {
    console.log('[brb] llama.cpp servers not available — running in passthrough mode');
  }

  // Recover orphaned checkpoints after server is listening
  recoverOrphanedCheckpoints();
});

// Graceful shutdown
for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sig, () => {
    console.log(`[brb] ${sig} received, shutting down...`);
    clearInterval(sessionInterval);
    ac.abort();
    memoryStore.close();
    process.exit(0);
  });
}
