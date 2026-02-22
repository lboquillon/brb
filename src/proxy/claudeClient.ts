// Copyright (c) 2026 Leonardo Boquillon <lboquillon at gmail dot com>
// Licensed under the MIT License. See LICENSE file for details.


import { IncomingMessage, ServerResponse } from 'node:http';
import { pipeSSE } from '../lib/sse';
import { createLogger } from '../lib/logger';

const log = createLogger('claude');

interface ContentBlock {
  type: string;
  text?: string;
}

interface ClaudeResponse {
  content?: ContentBlock[];
}

export async function forwardToClaudeStreaming(
  body: Record<string, unknown>,
  req: IncomingMessage,
  res: ServerResponse
): Promise<string> {
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: buildHeaders(req),
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(300_000),
  });

  if (!response.ok) {
    const errorBody = await response.text();
    log.error(`${response.status} from Anthropic:`, errorBody.slice(0, 500));
    if (response.status >= 500) {
      const sys = body.system;
      log.error('system field type:', Array.isArray(sys) ? `array[${sys.length}]` : typeof sys);
    }
    res.writeHead(response.status, {
      'Content-Type': response.headers.get('content-type') || 'application/json',
    });
    res.end(errorBody);
    return '';
  }

  const result = await pipeSSE(response, res);
  return result.fullText;
}

export async function forwardToClaudeNormal(
  body: Record<string, unknown>,
  req: IncomingMessage,
  res: ServerResponse
): Promise<string> {
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: buildHeaders(req),
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(300_000),
  });

  const responseBody = await response.text();
  res.writeHead(response.status, {
    'Content-Type': response.headers.get('content-type') || 'application/json',
  });
  res.end(responseBody);

  if (!response.ok) return '';

  try {
    const parsed = JSON.parse(responseBody) as ClaudeResponse;
    return (parsed.content || [])
      .filter((b) => b.type === 'text')
      .map((b) => b.text ?? '')
      .join('');
  } catch {
    return '';
  }
}

// Headers that must NOT be forwarded (hop-by-hop / node internals)
const SKIP_HEADERS = new Set([
  'host', 'connection', 'keep-alive', 'transfer-encoding',
  'te', 'trailer', 'upgrade', 'content-length',
]);

function buildHeaders(req: IncomingMessage): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(req.headers)) {
    if (SKIP_HEADERS.has(key)) continue;
    if (value === undefined) continue;
    out[key] = Array.isArray(value) ? value.join(', ') : value;
  }
  out['content-type'] = 'application/json';
  return out;
}
