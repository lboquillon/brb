// Copyright (c) 2026 Leonardo Boquillon <lboquillon at gmail dot com>
// Licensed under the MIT License. See LICENSE file for details.


const LEVELS = { debug: 0, info: 1, warn: 2, error: 3 } as const;
type Level = keyof typeof LEVELS;

const LABELS: Record<Level, string> = { debug: 'DBG', info: 'INF', warn: 'WRN', error: 'ERR' };

function currentLevel(): number {
  const raw = (process.env.BRB_LOG_LEVEL || 'info').toLowerCase();
  return LEVELS[raw as Level] ?? LEVELS.info;
}

function timestamp(): string {
  const d = new Date();
  const h = String(d.getHours()).padStart(2, '0');
  const m = String(d.getMinutes()).padStart(2, '0');
  const s = String(d.getSeconds()).padStart(2, '0');
  const ms = String(d.getMilliseconds()).padStart(3, '0');
  return `${h}:${m}:${s}.${ms}`;
}

export interface Logger {
  debug: (...args: unknown[]) => void;
  info: (...args: unknown[]) => void;
  warn: (...args: unknown[]) => void;
  error: (...args: unknown[]) => void;
}

export function createLogger(prefix: string): Logger {
  function emit(level: Level, args: unknown[]) {
    if (LEVELS[level] < currentLevel()) return;
    const out = level === 'error' ? console.error : console.log;
    out(`${timestamp()} ${LABELS[level]} [${prefix}]`, ...args);
  }

  return {
    debug: (...args) => emit('debug', args),
    info: (...args) => emit('info', args),
    warn: (...args) => emit('warn', args),
    error: (...args) => emit('error', args),
  };
}
