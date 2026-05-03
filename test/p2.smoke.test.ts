import { writeFileSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { buildApp } from '../src/server.js';
import { reloadPolicy } from '../src/pipeline/policy.js';

const app = buildApp();
const POLICY_PATH = process.env.POLICY_PATH!;

function setPolicy(yaml: string): void {
  writeFileSync(POLICY_PATH, yaml);
  reloadPolicy();
}

function resetPolicy(): void {
  setPolicy('version: 1\nrules: []\n');
}

describe('Prototype 2: policy engine + budget gate', () => {
  afterEach(() => resetPolicy());

  it('allows a request when no rule trips', async () => {
    setPolicy(`
version: 1
rules:
  - id: only-block-other-team
    when:
      team_id: other-team
    if:
      metric: daily_spend_usd
      op: gte
      value: 0
    action:
      type: REJECT
      message: not your team
`);

    const res = await request(app)
      .post('/v1/chat/completions')
      .set('X-Gateway-Team', 'budget-good')
      .set('X-Gateway-Feature', 'p2-allow')
      .send({
        model: 'gpt-4o-mini',
        messages: [{ role: 'user', content: 'hello within budget' }],
        max_tokens: 32,
      });

    expect(res.status).toBe(200);
    expect(res.headers['x-gateway-policy-action']).toBe('ALLOW');
    expect(res.body.choices[0].message.content.length).toBeGreaterThan(0);
  });

  it('rejects with 429 when the daily budget rule trips', async () => {
    setPolicy(`
version: 1
rules:
  - id: budget-bad-cap
    when:
      team_id: budget-bad
    if:
      metric: daily_spend_usd
      op: gte
      value: 0
    action:
      type: REJECT
      message: budget-bad has no budget today
`);

    const res = await request(app)
      .post('/v1/chat/completions')
      .set('X-Gateway-Team', 'budget-bad')
      .set('X-Gateway-Feature', 'p2-reject')
      .send({
        model: 'gpt-4o-mini',
        messages: [{ role: 'user', content: 'should be blocked' }],
        max_tokens: 32,
      });

    expect(res.status).toBe(429);
    expect(res.body.error.type).toBe('budget_exceeded');
    expect(res.body.error.rules_evaluated).toContain('budget-bad-cap');
    expect(res.headers['x-gateway-policy-action']).toBe('REJECT');
  });

  it('reroutes to a cheaper model when a reroute rule matches', async () => {
    setPolicy(`
version: 1
rules:
  - id: route-to-haiku
    when:
      feature_id: expensive-classifier
    action:
      type: REROUTE
      to:
        model: claude-haiku-4-5
        provider: anthropic
`);

    const res = await request(app)
      .post('/v1/chat/completions')
      .set('X-Gateway-Team', 'reroute-team')
      .set('X-Gateway-Feature', 'expensive-classifier')
      .send({
        model: 'gpt-4o',
        messages: [{ role: 'user', content: 'classify this please' }],
        max_tokens: 32,
      });

    expect(res.status).toBe(200);
    expect(res.body.model).toBe('claude-haiku-4-5');
    expect(res.headers['x-gateway-policy-action']).toBe('REROUTE');
  });

  it('returns Retry-After when a THROTTLE rule trips', async () => {
    setPolicy(`
version: 1
rules:
  - id: slow-down
    when:
      team_id: throttle-team
    if:
      metric: daily_spend_usd
      op: gte
      value: 0
    action:
      type: THROTTLE
      message: slow down
      retry_after_seconds: 7
`);

    const res = await request(app)
      .post('/v1/chat/completions')
      .set('X-Gateway-Team', 'throttle-team')
      .send({
        model: 'gpt-4o-mini',
        messages: [{ role: 'user', content: 'pls' }],
        max_tokens: 16,
      });

    expect(res.status).toBe(429);
    expect(res.body.error.type).toBe('rate_limited');
    expect(res.headers['retry-after']).toBe('7');
  });
});
