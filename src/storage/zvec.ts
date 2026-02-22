// Copyright (c) 2026 Leonardo Boquillon <lboquillon at gmail dot com>
// Licensed under the MIT License. See LICENSE file for details.


import { existsSync, rmSync } from 'node:fs';
import {
  SchemaBuilder, openOrCreate, initZVec, vectorSearch, filterSearch,
  isZVecError, ZVecDataType,
  type ZVecCollection,
} from '../lib/zvec-utils';
import { EMBED_DIM } from '../config';
import { createLogger } from '../lib/logger';

const log = createLogger('zvec');

export interface MemoryDoc {
  id: string;
  embedding: number[];
  content: string;
  category: string;
  confidence: number;
  strength: number;
  mentions: number;
  last_reinforced: string;
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
  mentions: number;
  last_reinforced: string;
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
  .int('mentions')
  .string('last_reinforced')
  .string('created_at')
  .string('last_accessed')
  .string('archived', { index: true })
  .string('archive_reason', { nullable: true })
  .build();

export interface SearchResult {
  id: string;
  score: number;
  fields: MemoryFields;
}

/** Validate and coerce zvec's Record<string, unknown> into typed MemoryFields.
 *  Falls back to safe defaults for missing fields (pre-migration docs). */
export function parseFields(raw: Record<string, unknown>): MemoryFields {
  return {
    content: typeof raw.content === 'string' ? raw.content : '',
    category: typeof raw.category === 'string' ? raw.category : 'unknown',
    confidence: typeof raw.confidence === 'number' ? raw.confidence : 0.5,
    strength: typeof raw.strength === 'number' ? raw.strength : 1.0,
    mentions: typeof raw.mentions === 'number' ? raw.mentions : 1,
    last_reinforced: typeof raw.last_reinforced === 'string' ? raw.last_reinforced
      : (typeof raw.created_at === 'string' ? raw.created_at : new Date().toISOString()),
    created_at: typeof raw.created_at === 'string' ? raw.created_at : new Date().toISOString(),
    last_accessed: typeof raw.last_accessed === 'string' ? raw.last_accessed
      : (typeof raw.created_at === 'string' ? raw.created_at : new Date().toISOString()),
    archived: typeof raw.archived === 'string' ? raw.archived : 'false',
    archive_reason: typeof raw.archive_reason === 'string' ? raw.archive_reason : '',
  };
}

export class MemoryStore {
  private collection!: ZVecCollection;

  init(dataDir: string) {
    initZVec();
    this.collection = openOrCreate(`${dataDir}/memories`, memorySchema);
    this.migrateSchema();
  }

  private migrateSchema() {
    const migrations: { name: string; dataType: typeof ZVecDataType[keyof typeof ZVecDataType] }[] = [
      { name: 'mentions', dataType: ZVecDataType.INT64 },
      { name: 'last_reinforced', dataType: ZVecDataType.STRING },
    ];
    for (const col of migrations) {
      try {
        this.collection.addColumnSync({ fieldSchema: { name: col.name, dataType: col.dataType, nullable: false } });
        log.info(`migrated: added column '${col.name}'`);
      } catch (err: unknown) {
        if (isZVecError(err)) {
          // ZVEC_ALREADY_EXISTS — column already present, skip
          continue;
        }
        throw err;
      }
    }
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
        mentions: item.mentions,
        last_reinforced: item.last_reinforced,
        created_at: item.created_at,
        last_accessed: item.last_accessed,
        archived: item.archived,
        archive_reason: item.archive_reason,
      },
    });
  }

  search(vector: number[], limit: number, includeArchived = false): SearchResult[] {
    const filter = includeArchived ? undefined : "archived = 'false'";
    const results = vectorSearch(this.collection, 'embedding', vector, limit, filter);
    // zvec returns cosine DISTANCE (0 = identical, 2 = opposite).
    // Convert to cosine SIMILARITY (1 = identical, -1 = opposite) for all callers.
    return results.map(r => ({ id: r.id, score: 1 - r.score, fields: parseFields(r.fields) }));
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

  filterOnly(filter: string): SearchResult[] {
    const results = filterSearch(this.collection, filter);
    return results.map(r => ({ id: r.id, score: r.score, fields: parseFields(r.fields) }));
  }

  optimize() {
    return this.collection.optimizeSync();
  }

  /** Destroy the collection and all its data. Used for index recovery. */
  destroy(dataDir: string) {
    try {
      this.collection.destroySync();
    } catch { /* already destroyed */ }
    // destroySync removes collection data but may leave the directory.
    // Remove it so ZVecCreateAndOpen can recreate from scratch.
    const collectionPath = `${dataDir}/memories`;
    if (existsSync(collectionPath)) {
      rmSync(collectionPath, { recursive: true });
    }
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
