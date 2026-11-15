// @vitest-environment node
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { longFetch } from '../long-fetch';

let server: http.Server;
let url = '';

beforeAll(async () => {
  server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c: Buffer) => (body += c.toString()));
    req.on('end', () => {
      if (req.url === '/slow') return; // never answers: only an abort ends it
      res.writeHead(req.url === '/bad' ? 400 : 200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ echo: body, auth: req.headers.authorization }));
    });
  });
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(() => {
  server.closeAllConnections();
  server.close();
});

describe('longFetch (PQ-T72)', () => {
  it('posts the body and answers as a fetch Response', async () => {
    const res = await longFetch(`${url}/ok`, {
      method: 'POST',
      headers: { Authorization: 'Bearer k', 'Content-Type': 'application/json' },
      body: '{"a":1}',
    });
    expect(res.ok).toBe(true);
    expect(res.headers.get('content-type')).toBe('application/json');
    expect(await res.json()).toEqual({ echo: '{"a":1}', auth: 'Bearer k' });
  });

  it('keeps an error status for the caller', async () => {
    const res = await longFetch(`${url}/bad`, { method: 'POST', headers: {}, body: '' });
    expect(res.status).toBe(400);
  });

  it('ends on abort', async () => {
    const ctrl = new AbortController();
    const call = longFetch(`${url}/slow`, {
      method: 'POST',
      headers: {},
      body: 'x',
      signal: ctrl.signal,
    });
    ctrl.abort(new Error('stop'));
    await expect(call).rejects.toThrow('stop');
  });
});
