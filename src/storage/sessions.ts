// Copyright (c) 2026 Leonardo Boquillon <lboquillon at gmail dot com>
// Licensed under the MIT License. See LICENSE file for details.


const sessions = new Map<string, { lastActivity: number }>();

const SESSION_TTL_MS = 30 * 60 * 1000; // 30 minutes
const CLEANUP_INTERVAL_MS = 5 * 60 * 1000; // every 5 minutes

export function touchSession(id: string) {
  sessions.set(id, { lastActivity: Date.now() });
}

export function getActiveSessions(): number {
  return sessions.size;
}

export function startSessionWatcher(): ReturnType<typeof setInterval> {
  return setInterval(() => {
    const now = Date.now();
    for (const [id, session] of sessions) {
      if (now - session.lastActivity > SESSION_TTL_MS) {
        sessions.delete(id);
      }
    }
  }, CLEANUP_INTERVAL_MS);
}
