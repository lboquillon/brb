import {
  describe, it, before, after, assert,
  createTestMemoryCollection, embedClient, llmClient,
  requireEmbed, requireLLM, requireLlamaCpp, insertTestMemory,
} from './setup';
import { containsPII, redactPII } from '../src/extraction/safety';
import { extractFacts } from '../src/extraction/extractor';

// --- PII safety tests (always run, no servers needed) ---

describe('PII safety', () => {
  it('detects email addresses', () => {
    assert.ok(containsPII('reach me at leo@example.com'));
    assert.ok(!containsPII('no PII here'));
  });

  it('detects phone numbers', () => {
    assert.ok(containsPII('call me at 555-123-4567'));
    assert.ok(containsPII('phone: 555.123.4567'));
  });

  it('detects SSNs', () => {
    assert.ok(containsPII('my ssn is 123-45-6789'));
  });

  it('detects credit card numbers', () => {
    assert.ok(containsPII('card: 4111 1111 1111 1111'));
    assert.ok(containsPII('card: 4111-1111-1111-1111'));
  });

  it('detects API keys', () => {
    assert.ok(containsPII('key is sk-abc123xyz456789012345'));
    assert.ok(containsPII('token ghp_abcdefghijklmnopqrstuvwxyz0123456789'));
  });

  it('redacts multiple PII types in one string', () => {
    const input = 'email foo@bar.com and key sk-abc123xyz456789012345 here';
    const result = redactPII(input);
    assert.ok(!result.includes('foo@bar.com'));
    assert.ok(!result.includes('sk-abc123'));
    assert.ok(result.includes('[REDACTED_EMAIL]'));
    assert.ok(result.includes('[REDACTED_API_KEY]'));
  });

  it('leaves clean text unchanged', () => {
    const input = 'User prefers TypeScript with strict mode';
    assert.equal(redactPII(input), input);
  });
});

// --- Extraction tests (need LLM on :9091) ---

describe('extractFacts', async () => {
  if (!await requireLLM()) return;

  it('extracts facts from a real conversation turn', async () => {
    const facts = await extractFacts(
      'I always use TypeScript with strict mode',
      'Got it, I will use strict TypeScript for this project.',
    );
    assert.ok(Array.isArray(facts));
    assert.ok(facts.length > 0, `expected at least 1 fact, got ${facts.length}`);
    const allContent = facts.map(f => f.content.toLowerCase()).join(' ');
    assert.ok(allContent.includes('typescript'), `expected "typescript" in: ${allContent}`);
  });

  it('returns empty array for no-content turn', async () => {
    const facts = await extractFacts(
      'thanks',
      'You are welcome!',
    );
    assert.ok(Array.isArray(facts));
    assert.ok(facts.length === 0, `expected 0 facts for pleasantries, got ${facts.length}`);
  });

  it('extracts facts from rich conversation', async () => {
    const facts = await extractFacts(
      'I am building a REST API with Go and PostgreSQL. My deadline is March 15. I chose Go because of its performance.',
      'Got it. I will set up a Go project with PostgreSQL and target March 15 for completion.',
    );
    assert.ok(Array.isArray(facts));
    assert.ok(facts.length > 0, `expected at least 1 fact from rich conversation, got ${facts.length}`);
    assert.ok(facts.every(f => typeof f.content === 'string' && f.content.length > 0));
  });

  it('discards speculative input about future preferences', async () => {
    const facts = await extractFacts(
      'I might like avocados if I get older',
      'Fair enough, tastes can change over time!',
    );
    assert.ok(Array.isArray(facts));
    assert.equal(facts.length, 0, `expected 0 facts for speculative input, got ${facts.length}: ${facts.map(f => f.content).join('; ')}`);
  });

  it('handles empty input gracefully', async () => {
    const facts = await extractFacts('', '');
    assert.ok(Array.isArray(facts));
  });
});
