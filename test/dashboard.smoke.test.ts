import { afterAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { buildApp } from '../src/server.js';
import { reloadPolicy } from '../src/pipeline/policy.js';

const app = buildApp();

async function fireOneRequest(headers: Record<string, string> = {}): Promise<void> {
  await request(app)
    .post('/v1/chat/completions')
    .set('X-Gateway-Team', headers['X-Gateway-Team'] ?? 'dash-team')
    .set('X-Gateway-Feature', headers['X-Gateway-Feature'] ?? 'dash-feature')
    .send({
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: 'hello dashboard' }],
      max_tokens: 16,
    });
}

describe('Dashboard endpoints', () => {
  afterAll(() => {
    // Restore the empty test policy so other suites stay neutral.
    reloadPolicy();
  });

  describe('GET /events', () => {
    it('returns recent cost events ordered newest first', async () => {
      await fireOneRequest();
      await fireOneRequest();
      const res = await request(app).get('/events?limit=10');
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.events)).toBe(true);
      expect(res.body.events.length).toBeGreaterThanOrEqual(2);
      const tsList: string[] = res.body.events.map((e: { timestamp: string }) => e.timestamp);
      const sorted = [...tsList].sort().reverse();
      expect(tsList).toEqual(sorted);
      const first = res.body.events[0];
      expect(first.event_id).toBeTruthy();
      expect(typeof first.cache_hit).toBe('boolean');
      expect(first.policy_action).toBeDefined();
    });

    it('rejects an invalid limit', async () => {
      const res = await request(app).get('/events?limit=99999');
      expect(res.status).toBe(400);
      expect(res.body.error.type).toBe('invalid_request');
    });
  });

  describe('GET /costs/timeseries', () => {
    it('returns time-bucketed points', async () => {
      await fireOneRequest();
      const res = await request(app).get('/costs/timeseries?bucket=minute');
      expect(res.status).toBe(200);
      expect(res.body.bucket).toBe('minute');
      expect(Array.isArray(res.body.points)).toBe(true);
      expect(res.body.points.length).toBeGreaterThanOrEqual(1);
      const point = res.body.points.at(-1);
      expect(point.bucket).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:00\.000Z$/);
      expect(typeof point.cost_usd).toBe('number');
      expect(typeof point.requests).toBe('number');
      expect(typeof point.cache_hits).toBe('number');
    });

    it('rejects an unknown bucket', async () => {
      const res = await request(app).get('/costs/timeseries?bucket=year');
      expect(res.status).toBe(400);
    });
  });

  describe('GET /policy and POST /policy/reload', () => {
    it('returns the parsed rules and cache config', async () => {
      const res = await request(app).get('/policy');
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.rules)).toBe(true);
      expect(res.body.cache).toBeDefined();
      expect(typeof res.body.cache.enabled).toBe('boolean');
    });

    it('reloads the policy on POST', async () => {
      const res = await request(app).post('/policy/reload');
      expect(res.status).toBe(200);
      expect(res.body.reloaded_at).toBeTruthy();
      expect(typeof res.body.rules).toBe('number');
      expect(res.body.path).toBeTruthy();
    });
  });

  describe('GET /events/stream', () => {
    it('opens an SSE connection and emits the hello event', async () => {
      const port = 18080 + Math.floor(Math.random() * 1000);
      const server = app.listen(port);
      try {
        await new Promise<void>((resolve, reject) => {
          const req = (globalThis as any).fetch
            ? null
            : null;
          const http = require('node:http');
          const r = http.get(`http://127.0.0.1:${port}/events/stream`, (res: any) => {
            expect(res.statusCode).toBe(200);
            expect(res.headers['content-type']).toMatch(/text\/event-stream/);
            let buffer = '';
            res.on('data', (chunk: Buffer) => {
              buffer += chunk.toString('utf8');
              if (buffer.includes('event: hello')) {
                r.destroy();
                resolve();
              }
            });
            res.on('error', reject);
          });
          r.on('error', reject);
          setTimeout(() => {
            r.destroy();
            reject(new Error('timeout waiting for hello event'));
          }, 3000);
        });
      } finally {
        server.close();
      }
    });

    it('streams a cost_event when a request is made', async () => {
      const port = 19080 + Math.floor(Math.random() * 1000);
      const server = app.listen(port);
      try {
        await new Promise<void>((resolve, reject) => {
          const http = require('node:http');
          const r = http.get(`http://127.0.0.1:${port}/events/stream`, (res: any) => {
            let buffer = '';
            let helloed = false;
            res.on('data', async (chunk: Buffer) => {
              buffer += chunk.toString('utf8');
              if (!helloed && buffer.includes('event: hello')) {
                helloed = true;
                // Once connected, fire a request through the same app.
                await fireOneRequest();
              }
              if (buffer.includes('event: cost_event')) {
                r.destroy();
                resolve();
              }
            });
            res.on('error', reject);
          });
          r.on('error', reject);
          setTimeout(() => {
            r.destroy();
            reject(new Error('timeout waiting for cost_event'));
          }, 5000);
        });
      } finally {
        server.close();
      }
    });
  });
});
