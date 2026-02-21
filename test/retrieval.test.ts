import {
  describe, it, before, after, assert,
  createTestMemoryCollection, embedClient, llmClient,
  requireEmbed, requireLLM, requireLlamaCpp, insertTestMemory,
} from './setup';
import { scoreCandidate, scoreAndRank, type RawCandidate } from '../src/retrieval/scorer';
import { injectMemories } from '../src/retrieval/injector';
import { rewriteQuery } from '../src/retrieval/queryRewriter';
import { vectorSearch } from '../src/lib/zvec-utils';

// --- Scorer tests (pure math, always run) ---

describe('scorer', () => {
  const now = new Date().toISOString();
  const daysAgo = (d: number) => new Date(Date.now() - d * 86400000).toISOString();

  it('scores a recent high-similarity candidate high', () => {
    const scored = scoreCandidate({
      id: 'a',
      score: 0.90,
      fields: {
        content: 'Uses PostgreSQL', category: 'technical_choice',
        strength: 1.0, confidence: 0.9,
        created_at: daysAgo(7), last_accessed: daysAgo(1),
        archived: 'false', archive_reason: '',
      },
    });
    assert.ok(scored.finalScore > 0.7, `expected >0.7, got ${scored.finalScore}`);
  });

  it('old stale candidate scores lower than fresh one at same similarity', () => {
    const fresh = scoreCandidate({
      id: 'fresh',
      score: 0.85,
      fields: {
        content: 'Switched to PostgreSQL', category: 'technical_choice',
        strength: 1.0, confidence: 0.85,
        created_at: daysAgo(14), last_accessed: daysAgo(1),
        archived: 'false', archive_reason: '',
      },
    });
    const stale = scoreCandidate({
      id: 'stale',
      score: 0.91,
      fields: {
        content: 'Uses MySQL', category: 'technical_choice',
        strength: 1.0, confidence: 0.80,
        created_at: daysAgo(90), last_accessed: daysAgo(90),
        archived: 'false', archive_reason: '',
      },
    });
    assert.ok(
      fresh.finalScore > stale.finalScore,
      `fresh ${fresh.finalScore.toFixed(3)} should beat stale ${stale.finalScore.toFixed(3)}`
    );
  });

  it('scoreAndRank filters below MIN_SCORE and limits to MAX_MEMORIES', () => {
    const candidates = Array.from({ length: 20 }, (_, i) => ({
      id: `c${i}`,
      score: 0.5 + i * 0.025,
      fields: {
        content: `fact ${i}`, category: 'project_context',
        strength: 1.0, confidence: 0.8,
        created_at: now, last_accessed: now,
        archived: 'false', archive_reason: '',
      },
    }));
    const ranked = scoreAndRank(candidates as unknown as RawCandidate[]);
    assert.ok(ranked.length <= 10, `expected <=10, got ${ranked.length}`);
    assert.ok(ranked.every(m => m.finalScore >= 0.3));
    // Should be sorted descending
    for (let i = 1; i < ranked.length; i++) {
      assert.ok(ranked[i - 1].finalScore >= ranked[i].finalScore);
    }
  });

  it('very low similarity candidate gets filtered out', () => {
    const ranked = scoreAndRank([{
      id: 'noise',
      score: 0.1,
      fields: {
        content: 'irrelevant', category: 'preference',
        strength: 0.5, confidence: 0.3,
        created_at: daysAgo(200), last_accessed: daysAgo(200),
        archived: 'false', archive_reason: '',
      },
    }]);
    assert.equal(ranked.length, 0);
  });
});

// --- Injector tests (pure string manipulation, always run) ---

describe('injector', () => {
  it('returns original body unchanged when no memories', () => {
    const body = { messages: [{ role: 'user', content: 'hi' }], stream: true };
    const result = injectMemories(body, []);
    assert.deepStrictEqual(result, body);
  });

  it('prepends memories to existing system prompt', () => {
    const body = { system: 'You are a helpful assistant.', messages: [] };
    const result = injectMemories(body, [
      { id: '1', content: 'Uses TypeScript', category: 'preference', similarity: 0.9, finalScore: 0.8 },
    ]);
    const sys = result.system as string;
    assert.ok(sys.includes('[USER CONTEXT]'));
    assert.ok(sys.includes('Uses TypeScript'));
    assert.ok(sys.includes('You are a helpful assistant.'));
    // Memory comes after existing system prompt (Lesson 4: preserve prompt cache prefix)
    assert.ok(sys.indexOf('You are a helpful') < sys.indexOf('[USER CONTEXT]'));
  });

  it('creates system field when none exists', () => {
    const body = { messages: [] };
    const result = injectMemories(body, [
      { id: '1', content: 'Prefers Go', category: 'preference', similarity: 0.85, finalScore: 0.75 },
    ]);
    const sys = result.system as string;
    assert.ok(sys.includes('Prefers Go'));
    assert.ok(!sys.includes('\n\n'));  // no trailing separator when no existing system
  });

  it('does not mutate original body', () => {
    const body = { system: 'original', messages: [{ role: 'user', content: 'hi' }] };
    const copy = JSON.parse(JSON.stringify(body));
    injectMemories(body, [
      { id: '1', content: 'fact', category: 'c', similarity: 0.9, finalScore: 0.8 },
    ]);
    assert.deepStrictEqual(body, copy);
  });
});

// --- Query rewriter tests (need LLM on :9091) ---

describe('queryRewriter', async () => {
  if (!await requireLLM()) return;

  it('rewrites a vague query into something searchable', async () => {
    const result = await rewriteQuery('where were we on that thing?', [
      { role: 'user', content: 'can you check the revenue chart component?' },
      { role: 'assistant', content: 'I updated the date range filter.' },
      { role: 'user', content: 'looks good, commit and move on' },
      { role: 'assistant', content: 'committed. want to tackle pagination next?' },
      { role: 'user', content: 'where were we on that thing?' },
    ]);
    assert.ok(result.length > 0);
    assert.ok(result.length < 200);
    // Should be different from the raw vague message
    assert.notEqual(result, 'where were we on that thing?');
  });

  it('returns something for an explicit query too', async () => {
    const result = await rewriteQuery('add pagination to the revenue endpoint', [
      { role: 'user', content: 'add pagination to the revenue endpoint' },
    ]);
    assert.ok(result.length > 0);
  });
});

// --- Full retrieval pipeline with real embeddings ---

describe('retrieval with real embeddings', async () => {
  if (!await requireEmbed()) return;

  let col: any;
  let cleanup: () => void;

  before(async () => {
    ({ collection: col, cleanup } = createTestMemoryCollection());
    await insertTestMemory(col, 'Uses Next.js for the restaurant dashboard');
    await insertTestMemory(col, 'Switched from MySQL to PostgreSQL two weeks ago');
    await insertTestMemory(col, 'Frontend styled with Tailwind CSS');
    await insertTestMemory(col, 'Prefers dark mode in VS Code');
    await insertTestMemory(col, 'Backend API built with Express and TypeScript');
  });

  after(() => cleanup());

  it('vector search + scoring returns results and ranks them', async () => {
    const queryVec = await embedClient.embed('restaurant dashboard progress');
    const candidates = vectorSearch(col, 'embedding', queryVec, 10, "archived = 'false'");
    const ranked = scoreAndRank(candidates as unknown as RawCandidate[]);

    assert.ok(ranked.length > 0, 'should return at least one result');
    // All results should have scores and content
    assert.ok(ranked.every(m => m.finalScore > 0 && m.content.length > 0));
    // Should be sorted descending
    for (let i = 1; i < ranked.length; i++) {
      assert.ok(ranked[i - 1].finalScore >= ranked[i].finalScore);
    }
    // Restaurant content should appear somewhere in results
    const allContent = ranked.map(m => m.content.toLowerCase()).join(' ');
    assert.ok(
      allContent.includes('restaurant') || allContent.includes('next'),
      `expected restaurant content in results: ${ranked.map(m => m.content).join('; ')}`
    );
  });

  it('database query finds database-related content in results', async () => {
    const queryVec = await embedClient.embed('what database do they use');
    const candidates = vectorSearch(col, 'embedding', queryVec, 10, "archived = 'false'");
    const ranked = scoreAndRank(candidates as unknown as RawCandidate[]);

    assert.ok(ranked.length > 0);
    // PostgreSQL content should appear somewhere in top results
    const allContent = ranked.map(m => m.content.toLowerCase()).join(' ');
    assert.ok(
      allContent.includes('postgresql') || allContent.includes('mysql') || allContent.includes('database'),
      `expected database content in results: ${ranked.map(m => m.content).join('; ')}`
    );
  });
});
