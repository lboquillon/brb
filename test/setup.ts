import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import {
  initZVec, SchemaBuilder, createTempCollection,
  type ZVecCollection,
} from '../src/lib/zvec-utils';
import { EmbedClient, LLMClient } from '../src/lib/llm-client';

// Shared clients — constructed once, reused across test files
export const embedClient = new EmbedClient({ url: 'http://localhost:9090' });
export const llmClient = new LLMClient({ url: 'http://localhost:9091' });

// Skip helpers — check which servers are available
export async function requireEmbed() {
  const ok = await embedClient.healthy();
  if (!ok) {
    console.log('⚠ Skipping: embedding server not running');
    return false;
  }
  return true;
}

export async function requireLLM() {
  const ok = await llmClient.healthy();
  if (!ok) {
    console.log('⚠ Skipping: LLM server not running');
    return false;
  }
  return true;
}

export async function requireLlamaCpp() {
  const embedOk = await embedClient.healthy();
  const llmOk = await llmClient.healthy();
  if (!embedOk || !llmOk) {
    console.log(`⚠ Skipping: llama.cpp servers not running (embed=${embedOk}, llm=${llmOk})`);
    return false;
  }
  return true;
}

// Build a test collection with brb's memory schema
export function createTestMemoryCollection() {
  const schema = new SchemaBuilder('test_memories')
    .vector('embedding', 768)
    .string('content')
    .string('category', { index: true })
    .float('confidence')
    .float('strength')
    .int('mentions')
    .string('last_reinforced')
    .string('created_at')
    .string('last_accessed')
    .string('archived', { index: true })
    .string('archive_reason', { nullable: true })
    .build();

  return createTempCollection(schema);
}

// Insert a test memory with real embedding from llama.cpp
export async function insertTestMemory(
  collection: ZVecCollection,
  content: string,
  overrides?: {
    category?: string;
    confidence?: number;
    strength?: number;
    mentions?: number;
    last_reinforced?: string;
    created_at?: string;
    last_accessed?: string;
    archived?: string;
  }
) {
  const embedding = await embedClient.embed(content);
  const now = new Date().toISOString();
  const id = crypto.randomUUID();

  collection.insertSync({
    id,
    vectors: { embedding },
    fields: {
      content,
      category: overrides?.category ?? 'project_context',
      confidence: overrides?.confidence ?? 0.85,
      strength: overrides?.strength ?? 1.0,
      mentions: overrides?.mentions ?? 1,
      last_reinforced: overrides?.last_reinforced ?? now,
      created_at: overrides?.created_at ?? now,
      last_accessed: overrides?.last_accessed ?? now,
      archived: overrides?.archived ?? 'false',
      archive_reason: '',
    },
  });

  return { id, embedding };
}

// Re-export for convenience in test files
export { describe, it, before, after, assert };
