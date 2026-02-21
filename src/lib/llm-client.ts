// Copyright (c) 2026 Leonardo Boquillon <lboquillon at gmail dot com>
// Licensed under the MIT License. See LICENSE file for details.


// --- Response types for llama.cpp compatible APIs ---

interface ChatCompletionResponse {
  choices: {
    message: {
      content: string;
    };
  }[];
}

interface EmbeddingResponse {
  embedding: number[][];
}

interface HealthResponse {
  status: string;
}

// --- Client configs ---

export interface LLMClientConfig {
  url: string;
  timeoutMs?: number;
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface ChatOptions {
  temperature?: number;
  maxTokens?: number;
  jsonMode?: boolean;
}

export class LLMClient {
  private url: string;
  private timeoutMs: number;

  constructor(config: LLMClientConfig) {
    this.url = config.url;
    this.timeoutMs = config.timeoutMs ?? 30_000;
  }

  async chat(
    messages: ChatMessage[],
    opts?: ChatOptions,
  ): Promise<string> {
    const body: Record<string, unknown> = {
      messages,
      temperature: opts?.temperature ?? 0.1,
      max_tokens: opts?.maxTokens ?? 1024,
      stream: false,
    };
    if (opts?.jsonMode) {
      body.response_format = { type: 'json_object' };
    }

    const response = await fetch(`${this.url}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(this.timeoutMs),
    });

    if (!response.ok) {
      throw new Error(`LLM chat failed: ${response.status}`, {
        cause: await response.text(),
      });
    }

    const data = await response.json() as ChatCompletionResponse;
    const content = data.choices?.[0]?.message?.content;

    if (typeof content !== 'string') {
      throw new Error('LLM returned unexpected shape: missing choices[0].message.content');
    }

    return content;
  }

  async chatJSON<T = unknown>(
    messages: ChatMessage[],
    opts?: Omit<ChatOptions, 'jsonMode'>,
  ): Promise<T> {
    const raw = await this.chat(messages, { ...opts, jsonMode: true });
    return JSON.parse(raw) as T;
  }

  async healthy(): Promise<boolean> {
    try {
      const res = await fetch(`${this.url}/health`, {
        signal: AbortSignal.timeout(3_000),
      });
      if (!res.ok) return false;
      const data = await res.json() as HealthResponse;
      return data.status === 'ok';
    } catch {
      return false;
    }
  }
}

export interface EmbedClientConfig {
  url: string;
  timeoutMs?: number;
}

export class EmbedClient {
  private url: string;
  private timeoutMs: number;

  constructor(config: EmbedClientConfig) {
    this.url = config.url;
    this.timeoutMs = config.timeoutMs ?? 30_000;
  }

  async embed(text: string): Promise<number[]> {
    const response = await fetch(`${this.url}/embedding`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: text }),
      signal: AbortSignal.timeout(this.timeoutMs),
    });

    if (!response.ok) {
      throw new Error(`Embed failed: ${response.status}`, {
        cause: await response.text(),
      });
    }

    // llama.cpp returns [{embedding: [[0.1, 0.2, ...]]}]
    const data = await response.json() as EmbeddingResponse[];
    const vector = data[0]?.embedding?.[0];

    if (!Array.isArray(vector)) {
      throw new Error('Embed returned unexpected shape: missing [0].embedding[0]');
    }

    return vector;
  }

  async healthy(): Promise<boolean> {
    try {
      const res = await fetch(`${this.url}/health`, {
        signal: AbortSignal.timeout(3_000),
      });
      if (!res.ok) return false;
      const data = await res.json() as HealthResponse;
      return data.status === 'ok';
    } catch {
      return false;
    }
  }
}
