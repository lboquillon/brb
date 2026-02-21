import {
  describe, it, assert, requireLlamaCpp, embedClient, llmClient,
} from './setup';

describe('EmbedClient', async () => {
  if (!await requireLlamaCpp()) return;

  it('returns 768-dim vector for text input', async () => {
    const vec = await embedClient.embed('hello world');
    assert.equal(vec.length, 768);
    assert.equal(typeof vec[0], 'number');
  });

  it('similar texts produce similar embeddings', async () => {
    const v1 = await embedClient.embed('uses PostgreSQL for the database');
    const v2 = await embedClient.embed('database is PostgreSQL');
    const v3 = await embedClient.embed('prefers dark mode in VS Code');

    const sim12 = cosine(v1, v2);
    const sim13 = cosine(v1, v3);

    // Related texts should be more similar than unrelated
    assert.ok(sim12 > sim13, `expected sim(pg,pg) ${sim12} > sim(pg,dark) ${sim13}`);
    assert.ok(sim12 > 0.7, `expected sim(pg,pg) ${sim12} > 0.7`);
  });
});

describe('LLMClient', async () => {
  if (!await requireLlamaCpp()) return;

  it('chat returns a string response', async () => {
    const result = await llmClient.chat([
      { role: 'user', content: 'Say hello in exactly one word.' },
    ]);
    assert.equal(typeof result, 'string');
    assert.ok(result.length > 0);
  });

  it('chatJSON parses structured JSON response', async () => {
    const result = await llmClient.chatJSON<{ colors: string[] }>([
      { role: 'system', content: 'Respond with a JSON object: {"colors": ["..."]}' },
      { role: 'user', content: 'List 3 colors.' },
    ]);
    assert.ok(result.colors, 'expected colors key in response');
    assert.ok(Array.isArray(result.colors));
    assert.ok(result.colors.length > 0);
  });

  it('healthy returns true when server is running', async () => {
    const ok = await llmClient.healthy();
    assert.equal(ok, true);
  });
});

describe('EmbedClient health', async () => {
  if (!await requireLlamaCpp()) return;

  it('healthy returns true when server is running', async () => {
    const ok = await embedClient.healthy();
    assert.equal(ok, true);
  });
});

// Helper: cosine similarity
function cosine(a: number[], b: number[]): number {
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}
