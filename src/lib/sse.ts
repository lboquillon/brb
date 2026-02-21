// Copyright (c) 2026 Leonardo Boquillon <lboquillon at gmail dot com>
// Licensed under the MIT License. See LICENSE file for details.


import { ServerResponse } from 'node:http';

export interface SSEParseResult {
  fullText: string;
}

interface SSEEvent {
  type?: string;
  delta?: { type?: string; text?: string };
}

export async function pipeSSE(
  response: Response,
  clientRes: ServerResponse,
  opts?: {
    extractText?: (parsed: SSEEvent) => string | null;
  }
): Promise<SSEParseResult> {
  clientRes.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
  });

  const extractText = opts?.extractText ?? defaultExtractText;
  let fullText = '';
  let sseBuffer = '';
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      const chunk = decoder.decode(value, { stream: true });
      clientRes.write(chunk);

      // Buffer across chunk boundaries (W1)
      sseBuffer += chunk;
      const events = sseBuffer.split('\n\n');
      sseBuffer = events.pop() || '';

      for (const event of events) {
        const dataLine = event.split('\n').find(l => l.startsWith('data: '));
        if (!dataLine) continue;
        const jsonStr = dataLine.slice(6);
        if (jsonStr === '[DONE]') continue;
        try {
          const parsed = JSON.parse(jsonStr) as SSEEvent;
          const text = extractText(parsed);
          if (text) fullText += text;
        } catch { /* partial JSON, skip */ }
      }
    }
  } finally {
    reader.releaseLock();
    clientRes.end();
  }

  return { fullText };
}

function defaultExtractText(parsed: SSEEvent): string | null {
  if (parsed.type === 'content_block_delta'
      && parsed.delta?.type === 'text_delta') {
    return parsed.delta.text ?? null;
  }
  return null;
}
