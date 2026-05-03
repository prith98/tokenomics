import { randomUUID } from 'node:crypto';
import { config } from './config.js';
import { log } from './log.js';
import { computeCost } from './pricing.js';
import { db, insertCostEvent } from './store/sqlite.js';
import type { CostEvent, PolicyAction, Provider } from './types.js';

const SEED_AGENT_ID = 'demo-seed-bot';
const SEED_WINDOW_MINUTES = 60;

interface SeedSpec {
  team: string;
  feature: string;
  provider: Provider;
  model: string;
  reroutedFrom?: string;
  inputTokens: number;
  outputTokens: number;
  policyAction: PolicyAction;
  cacheHitType?: 'exact' | 'semantic';
  streaming?: boolean;
}

const SPECS: SeedSpec[] = [
  // doc-summarizer — main traffic, with cache hits
  { team: 'platform-team', feature: 'doc-summarizer', provider: 'openai', model: 'gpt-4o-mini', inputTokens: 420, outputTokens: 180, policyAction: 'ALLOW' },
  { team: 'platform-team', feature: 'doc-summarizer', provider: 'openai', model: 'gpt-4o-mini', inputTokens: 380, outputTokens: 220, policyAction: 'ALLOW' },
  { team: 'platform-team', feature: 'doc-summarizer', provider: 'openai', model: 'gpt-4o-mini', inputTokens: 510, outputTokens: 145, policyAction: 'ALLOW' },
  { team: 'platform-team', feature: 'doc-summarizer', provider: 'openai', model: 'gpt-4o-mini', inputTokens: 420, outputTokens: 180, policyAction: 'ALLOW', cacheHitType: 'exact' },
  { team: 'platform-team', feature: 'doc-summarizer', provider: 'openai', model: 'gpt-4o-mini', inputTokens: 290, outputTokens: 110, policyAction: 'ALLOW' },
  { team: 'growth-team', feature: 'doc-summarizer', provider: 'openai', model: 'gpt-4o-mini', inputTokens: 410, outputTokens: 175, policyAction: 'ALLOW', cacheHitType: 'semantic' },
  { team: 'growth-team', feature: 'doc-summarizer', provider: 'openai', model: 'gpt-4o-mini', inputTokens: 660, outputTokens: 240, policyAction: 'ALLOW' },
  { team: 'platform-team', feature: 'doc-summarizer', provider: 'openai', model: 'gpt-4o-mini', inputTokens: 380, outputTokens: 220, policyAction: 'ALLOW', cacheHitType: 'exact' },
  { team: 'growth-team', feature: 'doc-summarizer', provider: 'openai', model: 'gpt-4o-mini', inputTokens: 540, outputTokens: 200, policyAction: 'ALLOW' },

  // code-reviewer — heavier prompts, gpt-4o
  { team: 'platform-team', feature: 'code-reviewer', provider: 'openai', model: 'gpt-4o', inputTokens: 2100, outputTokens: 480, policyAction: 'ALLOW' },
  { team: 'platform-team', feature: 'code-reviewer', provider: 'openai', model: 'gpt-4o', inputTokens: 1850, outputTokens: 520, policyAction: 'ALLOW' },
  { team: 'platform-team', feature: 'code-reviewer', provider: 'openai', model: 'gpt-4o', inputTokens: 2400, outputTokens: 610, policyAction: 'ALLOW' },
  { team: 'ml-team', feature: 'code-reviewer', provider: 'openai', model: 'gpt-4o', inputTokens: 1700, outputTokens: 410, policyAction: 'ALLOW' },

  // expensive-classifier — REROUTE rule fires (gpt-4o → claude-haiku)
  { team: 'growth-team', feature: 'expensive-classifier', provider: 'anthropic', model: 'claude-haiku-4-5', reroutedFrom: 'gpt-4o', inputTokens: 320, outputTokens: 80, policyAction: 'REROUTE' },
  { team: 'growth-team', feature: 'expensive-classifier', provider: 'anthropic', model: 'claude-haiku-4-5', reroutedFrom: 'gpt-4o', inputTokens: 410, outputTokens: 95, policyAction: 'REROUTE' },
  { team: 'growth-team', feature: 'expensive-classifier', provider: 'anthropic', model: 'claude-haiku-4-5', reroutedFrom: 'gpt-4o', inputTokens: 285, outputTokens: 70, policyAction: 'REROUTE' },
  { team: 'platform-team', feature: 'expensive-classifier', provider: 'anthropic', model: 'claude-haiku-4-5', reroutedFrom: 'gpt-4o', inputTokens: 360, outputTokens: 88, policyAction: 'REROUTE' },

  // chat-assistant — streaming
  { team: 'ml-team', feature: 'chat-assistant', provider: 'openai', model: 'gpt-4o-mini', inputTokens: 480, outputTokens: 320, policyAction: 'ALLOW', streaming: true },
  { team: 'ml-team', feature: 'chat-assistant', provider: 'openai', model: 'gpt-4o-mini', inputTokens: 520, outputTokens: 410, policyAction: 'ALLOW', streaming: true },
  { team: 'platform-team', feature: 'chat-assistant', provider: 'openai', model: 'gpt-4o-mini', inputTokens: 340, outputTokens: 280, policyAction: 'ALLOW' },

  // budget rejection demo
  { team: 'growth-team', feature: 'doc-summarizer', provider: 'openai', model: 'gpt-4o-mini', inputTokens: 0, outputTokens: 0, policyAction: 'REJECT' },
];

function clearPriorSeedData(): void {
  db.prepare('DELETE FROM cost_events WHERE agent_id = ?').run(SEED_AGENT_ID);
}

function buildEvent(spec: SeedSpec, timestamp: Date, sessionId: string): CostEvent {
  const isCacheHit = spec.cacheHitType !== undefined;
  const isReject = spec.policyAction === 'REJECT';

  const inputTokens = isReject ? 0 : spec.inputTokens;
  const outputTokens = isReject || isCacheHit ? 0 : spec.outputTokens;

  const realCost = computeCost(spec.provider, spec.model, spec.inputTokens, spec.outputTokens);
  const charged = isReject || isCacheHit
    ? { input_cost_usd: 0, output_cost_usd: 0, total_cost_usd: 0 }
    : realCost;

  const totalLatency = isCacheHit ? 14 + Math.floor(Math.random() * 12) : 380 + Math.floor(Math.random() * 700);
  const ttft = spec.streaming ? 180 + Math.floor(Math.random() * 120) : null;

  return {
    event_id: randomUUID(),
    request_id: randomUUID(),
    timestamp: timestamp.toISOString(),
    team_id: spec.team,
    feature_id: spec.feature,
    agent_id: SEED_AGENT_ID,
    session_id: sessionId,
    user_id: `demo-user-${spec.team.split('-')[0]}`,
    environment: 'production',
    provider: spec.provider,
    model: spec.model,
    original_model: spec.reroutedFrom,
    input_tokens: inputTokens,
    output_tokens: outputTokens,
    total_tokens: inputTokens + outputTokens,
    cached_input_tokens: 0,
    reasoning_tokens: 0,
    input_cost_usd: charged.input_cost_usd,
    output_cost_usd: charged.output_cost_usd,
    total_cost_usd: charged.total_cost_usd,
    pricing_version: config.pricingVersion,
    total_latency_ms: totalLatency,
    ttft_ms: ttft,
    gateway_overhead_ms: 6 + Math.floor(Math.random() * 8),
    policy_action: spec.policyAction,
    cache_hit: isCacheHit,
    cache_hit_type: spec.cacheHitType,
    cache_savings_usd: isCacheHit ? realCost.total_cost_usd : undefined,
    was_budget_killed: false,
    stream_duration_ms: spec.streaming ? totalLatency - (ttft ?? 0) : undefined,
  };
}

export function seedDemoData(): void {
  clearPriorSeedData();

  const now = Date.now();
  const sessionId = `demo-${randomUUID().slice(0, 8)}`;
  const stepMs = (SEED_WINDOW_MINUTES * 60_000) / SPECS.length;

  let written = 0;
  SPECS.forEach((spec, i) => {
    const ts = new Date(now - (SPECS.length - i) * stepMs);
    insertCostEvent(buildEvent(spec, ts, sessionId));
    written += 1;
  });

  log.info({ written }, 'demo seed loaded');
}
