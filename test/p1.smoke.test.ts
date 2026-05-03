import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { buildApp } from '../src/server.js';

const app = buildApp();

describe('Prototype 1: token-aware proxy', () => {
  it('responds to /healthz', async () => {
    const res = await request(app).get('/healthz');
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  it('completes a chat request and emits a cost event', async () => {
    const res = await request(app)
      .post('/v1/chat/completions')
      .set('X-Gateway-Team', 'platform')
      .set('X-Gateway-Feature', 'doc-summarizer')
      .send({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: 'You are concise.' },
          { role: 'user', content: 'Summarize the architecture in one line.' },
        ],
        max_tokens: 64,
      });

    expect(res.status).toBe(200);
    expect(res.body.choices).toHaveLength(1);
    expect(res.body.choices[0].message.content.length).toBeGreaterThan(0);
    expect(res.body.usage.prompt_tokens).toBeGreaterThan(0);
    expect(res.body.usage.completion_tokens).toBeGreaterThan(0);
    expect(res.headers['x-gateway-request-id']).toBeTruthy();
    expect(Number(res.headers['x-gateway-cost-usd'])).toBeGreaterThanOrEqual(0);
    expect(res.headers['x-gateway-policy-action']).toBe('ALLOW');
    expect(res.headers['x-gateway-provider']).toBe('mock');
  });

  it('aggregates cost events at /costs', async () => {
    // Issue two requests for two different features
    await request(app)
      .post('/v1/chat/completions')
      .set('X-Gateway-Team', 'platform')
      .set('X-Gateway-Feature', 'feature-a')
      .send({
        model: 'gpt-4o-mini',
        messages: [{ role: 'user', content: 'hello A' }],
        max_tokens: 32,
      });

    await request(app)
      .post('/v1/chat/completions')
      .set('X-Gateway-Team', 'platform')
      .set('X-Gateway-Feature', 'feature-b')
      .send({
        model: 'gpt-4o-mini',
        messages: [{ role: 'user', content: 'hello B' }],
        max_tokens: 32,
      });

    const res = await request(app)
      .get('/costs')
      .query({ team_id: 'platform', group_by: 'feature_id,model' });

    expect(res.status).toBe(200);
    expect(res.body.total_requests).toBeGreaterThanOrEqual(2);
    expect(res.body.total_tokens).toBeGreaterThan(0);
    expect(res.body.breakdown.length).toBeGreaterThanOrEqual(2);
    const features = res.body.breakdown.map((r: { feature_id: string }) => r.feature_id);
    expect(features).toContain('feature-a');
    expect(features).toContain('feature-b');
  });

  it('rejects malformed requests with 400', async () => {
    const res = await request(app).post('/v1/chat/completions').send({ model: 'x' });
    expect(res.status).toBe(400);
    expect(res.body.error.type).toBe('invalid_request');
  });

  it('serves streaming requests as SSE (added in P3)', async () => {
    const res = await request(app)
      .post('/v1/chat/completions')
      .send({
        model: 'gpt-4o-mini',
        messages: [{ role: 'user', content: 'hi' }],
        stream: true,
      });
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/event-stream/);
    expect(res.text).toContain('data: [DONE]');
  });
});
