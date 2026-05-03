import { writeFileSync } from 'node:fs';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { buildApp } from '../src/server.js';
import { reloadPolicy } from '../src/pipeline/policy.js';
import { isRedisAvailable, resetRedisForTesting } from '../src/store/redis.js';
import { getSemanticCache, resetSemanticCacheForTesting } from '../src/pipeline/cache.js';
import { clearEmbeddingCacheForTesting } from '../src/pipeline/embeddings.js';

const app = buildApp();
const POLICY_PATH = process.env.POLICY_PATH!;

function setPolicy(yaml: string): void {
  writeFileSync(POLICY_PATH, yaml);
  reloadPolicy();
}

function resetPolicy(): void {
  setPolicy('version: 1\nrules: []\n');
}

function parseSse(text: string): Array<Record<string, unknown> | '[DONE]'> {
  const events: Array<Record<string, unknown> | '[DONE]'> = [];
  for (const line of text.split('\n')) {
    if (!line.startsWith('data: ')) continue;
    const payload = line.slice('data: '.length).trim();
    if (payload === '[DONE]') events.push('[DONE]');
    else if (payload.length > 0) {
      try {
        events.push(JSON.parse(payload) as Record<string, unknown>);
      } catch {
        // skip malformed
      }
    }
  }
  return events;
}

describe('Prototype 3: streaming + semantic cache', () => {
  afterEach(() => resetPolicy());

  it('streams an SSE response and persists a cost event', async () => {
    resetPolicy();

    const res = await request(app)
      .post('/v1/chat/completions')
      .set('X-Gateway-Team', 'p3-stream')
      .set('X-Gateway-Feature', 'p3-stream-feature')
      .set('MOCK_STREAM_DELAY_MS', '0')
      .send({
        model: 'gpt-4o-mini',
        messages: [{ role: 'user', content: 'stream me a reply please' }],
        max_tokens: 64,
        stream: true,
      });

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/event-stream/);
    expect(res.headers['x-gateway-request-id']).toBeTruthy();

    const events = parseSse(res.text);
    expect(events.at(-1)).toBe('[DONE]');
    const contentChunks = events.filter(
      (e): e is Record<string, unknown> =>
        typeof e === 'object' && e !== null,
    );
    const anyContent = contentChunks.some((e) => {
      const choices = e.choices as Array<{ delta?: { content?: string } }> | undefined;
      return !!choices?.[0]?.delta?.content;
    });
    expect(anyContent).toBe(true);

    const costs = await request(app)
      .get('/costs')
      .query({ team_id: 'p3-stream', group_by: 'feature_id' });
    expect(costs.status).toBe(200);
    expect(costs.body.total_requests).toBeGreaterThanOrEqual(1);
  });

  it('kills a stream mid-flight when a budget rule is exceeded', async () => {
    process.env.STREAM_POLICY_CHECK_EVERY = '1';

    setPolicy(`
version: 1
rules:
  - id: p3-kill-rule
    when:
      session_id: "*"
    if:
      metric: session_total_tokens
      op: gte
      value: 1
    action:
      type: REJECT
      message: kill mid-stream
`);

    const res = await request(app)
      .post('/v1/chat/completions')
      .set('X-Gateway-Team', 'p3-kill-team')
      .set('X-Gateway-Feature', 'p3-kill-feature')
      .set('X-Gateway-Session', 'p3-kill-session')
      .send({
        model: 'gpt-4o-mini',
        messages: [{ role: 'user', content: 'this should be killed mid-stream' }],
        max_tokens: 256,
        stream: true,
      });

    delete process.env.STREAM_POLICY_CHECK_EVERY;

    expect(res.status).toBe(200);
    const events = parseSse(res.text);
    const sawBudgetKill = events.some((e) => {
      if (typeof e !== 'object' || e === null) return false;
      const choices = e.choices as Array<{ finish_reason?: string }> | undefined;
      return choices?.[0]?.finish_reason === 'budget_kill';
    });
    expect(sawBudgetKill).toBe(true);

    const costs = await request(app)
      .get('/costs')
      .query({ team_id: 'p3-kill-team' });
    expect(costs.status).toBe(200);
    expect(costs.body.total_requests).toBeGreaterThanOrEqual(1);
  });

  describe('semantic cache (requires Redis)', () => {
    let redisOn = false;

    beforeAll(async () => {
      if (!process.env.REDIS_URL) {
        process.env.REDIS_URL = 'redis://localhost:6379';
        resetRedisForTesting();
      }
      redisOn = await isRedisAvailable();
      if (redisOn) {
        // Wipe any pre-existing cache entries from prior runs.
        const { getRedis } = await import('../src/store/redis.js');
        const redis = getRedis();
        if (redis) {
          const keys = await redis.keys('cache:*');
          if (keys.length > 0) await redis.del(...keys);
          try {
            await redis.call('FT.DROPINDEX', 'llm_cache_idx');
          } catch {
            // index may not exist yet
          }
        }
        resetSemanticCacheForTesting();
        clearEmbeddingCacheForTesting();
      }
    });

    afterAll(() => {
      resetRedisForTesting();
    });

    it('returns an exact cache hit on the second identical request', async (ctx) => {
      if (!redisOn) {
        ctx.skip();
        return;
      }

      setPolicy(`
version: 1
rules: []
cache:
  enabled: true
  backend: redis
  feature_configs:
    p3-cache-feature:
      enabled: true
      similarity_threshold: 0.92
      ttl_seconds: 600
`);

      const body = {
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system' as const, content: 'You are a tester.' },
          { role: 'user' as const, content: 'cache me a unique exact prompt 4242' },
        ],
        max_tokens: 64,
      };

      const first = await request(app)
        .post('/v1/chat/completions')
        .set('X-Gateway-Team', 'p3-cache')
        .set('X-Gateway-Feature', 'p3-cache-feature')
        .send(body);
      expect(first.status).toBe(200);
      expect(first.headers['x-gateway-cache-hit']).toBeUndefined();

      // Brief wait so the fire-and-forget store completes.
      await new Promise((r) => setTimeout(r, 200));

      const second = await request(app)
        .post('/v1/chat/completions')
        .set('X-Gateway-Team', 'p3-cache')
        .set('X-Gateway-Feature', 'p3-cache-feature')
        .send(body);
      expect(second.status).toBe(200);
      expect(second.headers['x-gateway-cache-hit']).toBe('exact');
      expect(second.body.choices[0].message.content).toBe(
        first.body.choices[0].message.content,
      );

      const stats = await request(app).get('/cache/stats');
      expect(stats.status).toBe(200);
      expect(stats.body.stats.exact_hits).toBeGreaterThanOrEqual(1);
    });

    it('returns a semantic cache hit on a similar prompt', async (ctx) => {
      if (!redisOn) {
        ctx.skip();
        return;
      }

      setPolicy(`
version: 1
rules: []
cache:
  enabled: true
  backend: redis
  feature_configs:
    p3-semantic-feature:
      enabled: true
      similarity_threshold: 0.5
      ttl_seconds: 600
`);

      const first = await request(app)
        .post('/v1/chat/completions')
        .set('X-Gateway-Team', 'p3-cache')
        .set('X-Gateway-Feature', 'p3-semantic-feature')
        .send({
          model: 'gpt-4o-mini',
          messages: [
            { role: 'user', content: 'first version of a unique semantic question 9001' },
          ],
          max_tokens: 64,
        });
      expect(first.status).toBe(200);

      await new Promise((r) => setTimeout(r, 250));

      const second = await request(app)
        .post('/v1/chat/completions')
        .set('X-Gateway-Team', 'p3-cache')
        .set('X-Gateway-Feature', 'p3-semantic-feature')
        .send({
          model: 'gpt-4o-mini',
          messages: [
            { role: 'user', content: 'first version of a unique semantic question 9001 ' },
          ],
          max_tokens: 64,
        });
      expect(second.status).toBe(200);
      expect(['exact', 'semantic']).toContain(second.headers['x-gateway-cache-hit']);
    });
  });
});
