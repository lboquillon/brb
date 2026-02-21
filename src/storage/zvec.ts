// Copyright (c) 2026 Leonardo Boquillon <lboquillon at gmail dot com>
// Licensed under the MIT License. See LICENSE file for details.


import {
  SchemaBuilder, openOrCreate, initZVec, vectorSearch, filterSearch,
  type ZVecCollection,
} from '../lib/zvec-utils';
import { EMBED_DIM } from '../config';

export interface MemoryDoc {
  id: string;
  embedding: number[];
  content: string;
  category: string;
  confidence: number;
  strength: number;
  created_at: string;
  last_accessed: string;
  archived: string;
  archive_reason: string;
}

export interface MemoryFields {
  content: string;
  category: string;
  confidence: number;
  strength: number;
  created_at: string;
  last_accessed: string;
  archived?: string;
  archive_reason?: string;
}

const memorySchema = new SchemaBuilder('memories')
  .vector('embedding', EMBED_DIM)
  .string('content')
  .string('category', { index: true })
  .float('confidence')
  .float('strength')
  .string('created_at')
  .string('last_accessed')
  .string('archived', { index: true })
  .string('archive_reason', { nullable: true })
  .build();

export class MemoryStore {
  private collection!: ZVecCollection;

  init(dataDir: string) {
    initZVec();
    this.collection = openOrCreate(`${dataDir}/memories`, memorySchema);
  }

  insert(item: MemoryDoc) {
    return this.collection.insertSync({
      id: item.id,
      vectors: { embedding: item.embedding },
      fields: {
        content: item.content,
        category: item.category,
        confidence: item.confidence,
        strength: item.strength,
        created_at: item.created_at,
        last_accessed: item.last_accessed,
        archived: item.archived,
        archive_reason: item.archive_reason,
      },
    });
  }

  search(vector: number[], limit: number, includeArchived = false) {
    const filter = includeArchived ? undefined : "archived = 'false'";
    const results = vectorSearch(this.collection, 'embedding', vector, limit, filter);
    // zvec returns cosine DISTANCE (0 = identical, 2 = opposite).
    // Convert to cosine SIMILARITY (1 = identical, -1 = opposite) for all callers.
    return (results as { id: string; score: number; fields: Record<string, unknown> }[])
      .map(r => ({ ...r, score: 1 - r.score }));
  }

  fetch(id: string) {
    return this.collection.fetchSync(id);
  }

  fetchMany(ids: string[]) {
    return this.collection.fetchSync(ids);
  }

  update(id: string, fields: Partial<MemoryFields>) {
    return this.collection.updateSync({ id, fields });
  }

  upsert(doc: { id: string; vectors: { embedding: number[] }; fields: Partial<MemoryFields> }) {
    return this.collection.upsertSync(doc);
  }

  archive(id: string, reason: string) {
    return this.collection.updateSync({
      id,
      fields: { archived: 'true', archive_reason: reason },
    });
  }

  delete(id: string) {
    return this.collection.deleteSync(id);
  }

  deleteByFilter(filter: string) {
    return this.collection.deleteByFilterSync(filter);
  }

  filterOnly(filter: string) {
    return filterSearch(this.collection, filter);
  }

  optimize() {
    return this.collection.optimizeSync();
  }

  close() {
    try {
      this.collection.closeSync();
    } catch { /* already closed */ }
  }

  get stats() {
    return this.collection.stats;
  }
}

export const memoryStore = new MemoryStore();
