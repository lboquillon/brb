// Copyright (c) 2026 Leonardo Boquillon <lboquillon at gmail dot com>
// Licensed under the MIT License. See LICENSE file for details.


import zvec from '@zvec/zvec';
import type { ZVecCollection, ZVecCollectionSchema } from '@zvec/zvec';
import { mkdirSync, existsSync } from 'node:fs';

const {
  ZVecDataType, ZVecIndexType, ZVecMetricType, ZVecQuantizeType,
  ZVecLogLevel, ZVecLogType, ZVecCollectionSchema: CollectionSchema,
  ZVecInitialize, ZVecCreateAndOpen, ZVecOpen, isZVecError,
} = zvec;

// --- Init ---

let _initialized = false;

export function initZVec(opts?: { logLevel?: typeof ZVecLogLevel[keyof typeof ZVecLogLevel] }) {
  if (_initialized) return;
  ZVecInitialize({
    logType: ZVecLogType.CONSOLE,
    logLevel: opts?.logLevel ?? ZVecLogLevel.WARN,
  });
  _initialized = true;
}

// --- Schema Builder ---
// Internal types are loose because they feed directly into the zvec library's
// CollectionSchema constructor which has its own runtime validation.

export class SchemaBuilder {
  private _name: string;
  private vectorDefs: Record<string, unknown>[] = [];
  private fieldDefs: Record<string, unknown>[] = [];

  constructor(name: string) {
    this._name = name;
  }

  vector(
    name: string,
    dimension: number,
    opts?: {
      metric?: 'cosine' | 'l2' | 'ip';
      quantize?: 'fp16';
      m?: number;
      efConstruction?: number;
    }
  ) {
    const metricMap = {
      cosine: ZVecMetricType.COSINE,
      l2: ZVecMetricType.L2,
      ip: ZVecMetricType.IP,
    };
    this.vectorDefs.push({
      name,
      dataType: ZVecDataType.VECTOR_FP32,
      dimension,
      indexParams: {
        indexType: ZVecIndexType.HNSW,
        metricType: metricMap[opts?.metric ?? 'cosine'],
        quantizeType: ZVecQuantizeType.FP16,
        ...(opts?.m && { m: opts.m }),
        ...(opts?.efConstruction && { efConstruction: opts.efConstruction }),
      },
    });
    return this;
  }

  string(name: string, opts?: { index?: boolean; nullable?: boolean }) {
    return this.field(name, ZVecDataType.STRING, opts);
  }

  float(name: string, opts?: { index?: boolean; nullable?: boolean }) {
    return this.field(name, ZVecDataType.FLOAT, opts);
  }

  int(name: string, opts?: { index?: boolean; nullable?: boolean }) {
    return this.field(name, ZVecDataType.INT64, opts);
  }

  bool(name: string, opts?: { index?: boolean; nullable?: boolean }) {
    return this.field(name, ZVecDataType.BOOL, opts);
  }

  arrayString(name: string, opts?: { index?: boolean; nullable?: boolean }) {
    return this.field(name, ZVecDataType.ARRAY_STRING, opts);
  }

  private field(
    name: string,
    dataType: typeof ZVecDataType[keyof typeof ZVecDataType],
    opts?: { index?: boolean; nullable?: boolean }
  ) {
    const def: Record<string, unknown> = {
      name,
      dataType,
      nullable: opts?.nullable ?? false,
    };
    if (opts?.index) {
      def.indexParams = { indexType: ZVecIndexType.INVERT };
    }
    this.fieldDefs.push(def);
    return this;
  }

  build(): ZVecCollectionSchema {
    const vectors = this.vectorDefs.length === 1 ? this.vectorDefs[0] : this.vectorDefs;
    // CollectionSchema does runtime validation; cast builder output at native boundary
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return new CollectionSchema({ name: this._name, vectors, fields: this.fieldDefs } as any);
  }
}

// --- Collection Lifecycle ---

export function openOrCreate(path: string, schema: ZVecCollectionSchema): ZVecCollection {
  const dir = path.split('/').slice(0, -1).join('/');
  if (dir && !existsSync(dir)) mkdirSync(dir, { recursive: true });

  try {
    return ZVecOpen(path);
  } catch (err: unknown) {
    if (isZVecError(err)) {
      // ZVEC_NOT_FOUND: collection doesn't exist yet
      // ZVEC_INVALID_ARGUMENT: path doesn't exist as a collection directory
      return ZVecCreateAndOpen(path, schema);
    }
    throw err;
  }
}

// --- Query Helpers ---

export function vectorSearch(
  collection: ZVecCollection,
  vectorField: string,
  vector: number[],
  topk: number,
  filter?: string
) {
  return collection.querySync({
    fieldName: vectorField,
    vector,
    topk,
    ...(filter && { filter }),
  });
}

export function filterSearch(collection: ZVecCollection, filter: string) {
  return collection.querySync({ filter });
}

// --- Temp Collections for Tests ---

let _tempCounter = 0;

export function createTempCollection(schema: ZVecCollectionSchema): {
  collection: ZVecCollection;
  path: string;
  cleanup: () => void;
} {
  initZVec();
  const path = `/tmp/zvec-test-${Date.now()}-${_tempCounter++}`;
  const collection = ZVecCreateAndOpen(path, schema);
  return {
    collection,
    path,
    cleanup: () => {
      try {
        collection.destroySync();
      } catch { /* already destroyed */ }
    },
  };
}

// Re-export for convenience
export {
  ZVecDataType, ZVecIndexType, ZVecMetricType, ZVecQuantizeType,
  ZVecLogLevel, ZVecLogType, ZVecCreateAndOpen, ZVecOpen, isZVecError,
};
export type { ZVecCollection, ZVecCollectionSchema } from '@zvec/zvec';
