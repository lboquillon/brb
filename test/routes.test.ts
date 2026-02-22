import { describe, it, before, after, assert } from './setup';
import { PassThrough } from 'node:stream';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { memoryStore } from '../src/storage/zvec';
import { route } from '../src/router';
import { mkdirSync, rmSync } from 'node:fs';

const TEST_DATA_DIR = `/tmp/brb-route-test-${Date.now()}`;

// --- Mock helpers ---

interface MockResponse {
  req: IncomingMessage;
  res: ServerResponse;
  getResponse: () => Promise<{ status: number; headers: Record<string, string>; body: unknown }>;
}

function mockRequest(method: string, path: string, body?: unknown): MockResponse {
  const req = new PassThrough() as unknown as IncomingMessage;
  req.method = method;
  req.url = path;
  req.headers = { host: 'localhost:3000' };

  if (body) {
    const data = JSON.stringify(body);
    (req as unknown as PassThrough).end(data);
  } else {
    (req as unknown as PassThrough).end();
  }

  let capturedStatus = 200;
  let capturedHeaders: Record<string, string> = {};
  let capturedBody = '';

  const res = new PassThrough() as unknown as ServerResponse;
  Object.defineProperty(res, 'headersSent', { value: false, writable: true });
  res.writeHead = ((status: number, headers?: Record<string, string>) => {
    capturedStatus = status;
    capturedHeaders = headers || {};
    (res as any).headersSent = true;
    return res;
  }) as ServerResponse['writeHead'];

  const originalEnd = (res as unknown as PassThrough).end.bind(res);
  (res as unknown as { end: Function }).end = (data?: string) => {
    if (data) capturedBody += data;
    originalEnd();
  };

  return {
    req,
    res,
    getResponse: () => new Promise((resolve) => {
      (res as unknown as PassThrough).on('finish', () => {
        let parsed: unknown;
        try {
          parsed = JSON.parse(capturedBody);
        } catch {
          parsed = capturedBody;
        }
        resolve({ status: capturedStatus, headers: capturedHeaders, body: parsed });
      });
    }),
  };
}

// --- Tests ---

describe('route handlers', () => {
  before(() => {
    mkdirSync(TEST_DATA_DIR, { recursive: true });
    memoryStore.init(TEST_DATA_DIR);
  });

  after(() => {
    memoryStore.close();
    try { rmSync(TEST_DATA_DIR, { recursive: true, force: true }); } catch { /* */ }
  });

  it('GET /health returns status JSON', async () => {
    const { req, res, getResponse } = mockRequest('GET', '/health');
    await route(req, res);
    const resp = await getResponse();
    assert.equal(resp.status, 200);
    const body = resp.body as Record<string, unknown>;
    assert.equal(body.proxy, 'ok');
    assert.ok('memories' in body);
    assert.ok('uptime' in body);
  });

  it('GET /memories returns empty list on fresh store', async () => {
    const { req, res, getResponse } = mockRequest('GET', '/memories');
    await route(req, res);
    const resp = await getResponse();
    assert.equal(resp.status, 200);
    const body = resp.body as Record<string, unknown>;
    assert.equal(body.total, 0);
    assert.deepStrictEqual(body.memories, []);
  });

  it('GET /memories/search without q returns 400', async () => {
    const { req, res, getResponse } = mockRequest('GET', '/memories/search');
    await route(req, res);
    const resp = await getResponse();
    assert.equal(resp.status, 400);
    const body = resp.body as Record<string, unknown>;
    assert.ok((body.error as string).includes('Missing'));
  });

  it('DELETE /memories/:id with invalid id returns 400', async () => {
    const { req, res, getResponse } = mockRequest('DELETE', '/memories/not-a-uuid');
    await route(req, res);
    const resp = await getResponse();
    assert.equal(resp.status, 400);
    const body = resp.body as Record<string, unknown>;
    assert.ok((body.error as string).includes('Invalid'));
  });

  it('DELETE /memories/:id with valid UUID returns success', async () => {
    const id = crypto.randomUUID();
    const { req, res, getResponse } = mockRequest('DELETE', `/memories/${id}`);
    await route(req, res);
    const resp = await getResponse();
    assert.equal(resp.status, 200);
    const body = resp.body as Record<string, unknown>;
    assert.equal(body.deleted, id);
  });

  it('GET /unknown returns 404', async () => {
    const { req, res, getResponse } = mockRequest('GET', '/unknown');
    await route(req, res);
    const resp = await getResponse();
    assert.equal(resp.status, 404);
    const body = resp.body as Record<string, unknown>;
    assert.ok((body.error as string).includes('Not found'));
  });
});
