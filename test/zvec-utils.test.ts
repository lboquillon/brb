import {
  describe, it, before, after, assert,
  createTestMemoryCollection, embedClient, requireLlamaCpp, insertTestMemory,
} from './setup';
import {
  vectorSearch, filterSearch, SchemaBuilder, createTempCollection, initZVec,
} from '../src/lib/zvec-utils';

// --- Tests that always run (zvec is in-process, no server needed) ---

describe('SchemaBuilder', () => {
  it('builds a valid schema and creates a collection', () => {
    const schema = new SchemaBuilder('sb_test')
      .vector('embedding', 4)
      .string('name')
      .float('score')
      .string('active', { index: true })
      .build();

    const { collection, cleanup } = createTempCollection(schema);
    try {
      collection.insertSync({
        id: 'test-1',
        vectors: { embedding: [0.1, 0.2, 0.3, 0.4] },
        fields: { name: 'hello', score: 0.9, active: 'true' },
      });

      const results = collection.querySync({
        fieldName: 'embedding',
        vector: [0.1, 0.2, 0.3, 0.4],
        topk: 5,
      });
      assert.ok(results.length === 1);
      assert.equal(results[0].fields.name, 'hello');
    } finally {
      cleanup();
    }
  });

  it('openOrCreate creates on first call, opens on second', async () => {
    const schema = new SchemaBuilder('oc_test')
      .vector('v', 4)
      .string('data')
      .build();

    const { collection: col1, path, cleanup } = createTempCollection(schema);
    col1.insertSync({
      id: 'persist-1',
      vectors: { v: [1, 0, 0, 0] },
      fields: { data: 'survives' },
    });
    col1.closeSync();

    const { openOrCreate } = await import('../src/lib/zvec-utils');
    const col2 = openOrCreate(path, schema);
    try {
      const fetched = col2.fetchSync('persist-1');
      assert.equal(fetched['persist-1'].fields.data, 'survives');
    } finally {
      col2.destroySync();
    }
  });
});

// --- Tests that need llama.cpp for real embeddings ---

describe('zvec-utils with real embeddings', async () => {
  if (!await requireLlamaCpp()) return;

  let col: any;
  let cleanup: () => void;

  before(async () => {
    ({ collection: col, cleanup } = createTestMemoryCollection());
    await insertTestMemory(col, 'Uses PostgreSQL for the database');
    await insertTestMemory(col, 'Frontend built with Next.js and Tailwind');
    await insertTestMemory(col, 'Prefers TypeScript over JavaScript');
  });

  after(() => cleanup());

  it('vector search finds relevant results', async () => {
    const queryVec = await embedClient.embed('what database do they use');
    const results = vectorSearch(col, 'embedding', queryVec, 5, "archived = 'false'");
    assert.ok(results.length > 0);
    assert.ok(results[0].fields.content.includes('PostgreSQL'));
  });

  it('filter search returns only matching docs', () => {
    const results = filterSearch(col, "category = 'project_context'");
    assert.ok(results.length === 3);
  });

  it('archived docs excluded from vector search', async () => {
    const { id } = await insertTestMemory(col, 'Old MySQL config', { archived: 'true' });
    const queryVec = await embedClient.embed('MySQL database');
    const results = vectorSearch(col, 'embedding', queryVec, 10, "archived = 'false'");
    const ids = results.map((r: any) => r.id);
    assert.ok(!ids.includes(id));
  });
});
