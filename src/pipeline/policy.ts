import { existsSync, readFileSync, watch, type FSWatcher } from 'node:fs';
import { resolve } from 'node:path';
import { parse as parseYaml } from 'yaml';
import { z } from 'zod';
import { log } from '../log.js';
import { bus } from './bus.js';
import {
  getDailySpendUsd,
  getMonthlySpendUsd,
  getSessionRequestCount,
  getSessionTotalTokens,
  getTokensInLastMinute,
} from '../store/sqlite.js';
import type {
  GatewayRequest,
  PolicyAction,
  PolicyDecision,
  Provider,
  RequestContext,
} from '../types.js';

// --- YAML schema ------------------------------------------------------------

const ProviderSchema = z.enum(['openai', 'anthropic', 'mock']);

const MetricSchema = z.enum([
  'daily_spend_usd',
  'monthly_spend_usd',
  'session_request_count',
  'session_total_tokens',
  'tokens_per_minute',
]);

const OpSchema = z.enum(['gte', 'gt', 'lte', 'lt', 'eq']);

const ActionTypeSchema = z.enum(['ALLOW', 'REJECT', 'THROTTLE', 'REROUTE']);

const WhenSchema = z
  .object({
    team_id: z.string().min(1).optional(),
    feature_id: z.string().min(1).optional(),
    agent_id: z.string().min(1).optional(),
    session_id: z.string().min(1).optional(),
    user_id: z.string().min(1).optional(),
  })
  .strict();

const IfSchema = z
  .object({
    metric: MetricSchema,
    op: OpSchema,
    value: z.number(),
  })
  .strict();

const RerouteTargetSchema = z
  .object({
    model: z.string().min(1),
    provider: ProviderSchema.optional(),
  })
  .strict();

const ActionSchema = z
  .object({
    type: ActionTypeSchema,
    message: z.string().optional(),
    retry_after_seconds: z.number().int().positive().optional(),
    to: RerouteTargetSchema.optional(),
  })
  .strict()
  .superRefine((a, ctx) => {
    if (a.type === 'REROUTE' && !a.to) {
      ctx.addIssue({ code: 'custom', message: 'REROUTE action requires a `to` target' });
    }
  });

const RuleSchema = z
  .object({
    id: z.string().min(1),
    description: z.string().optional(),
    when: WhenSchema.default({}),
    if: IfSchema.optional(),
    action: ActionSchema,
  })
  .strict();

const FeatureCacheConfigSchema = z
  .object({
    enabled: z.boolean().default(true),
    similarity_threshold: z.number().min(0).max(1).default(0.92),
    ttl_seconds: z.number().int().positive().default(3600),
  })
  .strict();

const CacheConfigSchema = z
  .object({
    enabled: z.boolean().default(true),
    backend: z.enum(['redis']).default('redis'),
    feature_configs: z.record(z.string(), FeatureCacheConfigSchema).default({}),
  })
  .strict()
  .default({ enabled: true, backend: 'redis', feature_configs: {} });

const PolicyDocSchema = z
  .object({
    version: z.literal(1),
    rules: z.array(RuleSchema).default([]),
    cache: CacheConfigSchema,
  })
  .strict();

export type PolicyRule = z.infer<typeof RuleSchema>;
export type PolicyDoc = z.infer<typeof PolicyDocSchema>;
export type FeatureCacheConfig = z.infer<typeof FeatureCacheConfigSchema>;
export type CacheConfig = z.infer<typeof CacheConfigSchema>;

const DEFAULT_CACHE_CONFIG: CacheConfig = {
  enabled: true,
  backend: 'redis',
  feature_configs: {},
};

let activeCacheConfig: CacheConfig = DEFAULT_CACHE_CONFIG;

export function getCacheConfig(): CacheConfig {
  return activeCacheConfig;
}

export function getFeatureCacheConfig(featureId: string): FeatureCacheConfig | null {
  if (!activeCacheConfig.enabled) return null;
  return activeCacheConfig.feature_configs[featureId] ?? null;
}

// --- Engine state -----------------------------------------------------------

const ACTION_PRIORITY: Record<PolicyAction, number> = {
  REJECT: 4,
  THROTTLE: 3,
  REROUTE: 2,
  ALLOW: 1,
};

let activeRules: PolicyRule[] = [];
activeCacheConfig = DEFAULT_CACHE_CONFIG;
let watcher: FSWatcher | null = null;
let reloadTimer: NodeJS.Timeout | null = null;

function policyPath(): string {
  return resolve(process.env.POLICY_PATH || './policy.yaml');
}

export function reloadPolicy(): { rules: number; path: string } {
  const path = policyPath();
  if (!existsSync(path)) {
    activeRules = [];
    activeCacheConfig = DEFAULT_CACHE_CONFIG;
    log.warn({ path }, 'policy file not found — running with empty rule set');
    return { rules: 0, path };
  }
  try {
    const raw = readFileSync(path, 'utf8');
    const parsed = PolicyDocSchema.parse(parseYaml(raw) ?? {});
    activeRules = parsed.rules;
    activeCacheConfig = parsed.cache;
    log.info({ path, rules: activeRules.length }, 'policy loaded');
    bus.emit('policyReloaded', {
      rules: activeRules.length,
      path,
      at: new Date().toISOString(),
    });
    return { rules: activeRules.length, path };
  } catch (err) {
    log.error({ err, path }, 'failed to load policy — keeping previous rule set');
    return { rules: activeRules.length, path };
  }
}

export function startPolicyWatcher(): void {
  if (watcher) return;
  reloadPolicy();
  const path = policyPath();
  if (!existsSync(path)) return;
  try {
    watcher = watch(path, () => {
      if (reloadTimer) clearTimeout(reloadTimer);
      reloadTimer = setTimeout(() => {
        reloadTimer = null;
        reloadPolicy();
      }, 100);
    });
    log.info({ path }, 'policy hot-reload watcher started');
  } catch (err) {
    log.warn({ err, path }, 'unable to start policy watcher');
  }
}

export function stopPolicyWatcher(): void {
  if (reloadTimer) {
    clearTimeout(reloadTimer);
    reloadTimer = null;
  }
  if (watcher) {
    watcher.close();
    watcher = null;
  }
}

export function getActiveRulesForTesting(): readonly PolicyRule[] {
  return activeRules;
}

export function getActiveRules(): readonly PolicyRule[] {
  return activeRules;
}

// --- Errors -----------------------------------------------------------------

export class PolicyRejectionError extends Error {
  constructor(
    public readonly decision: PolicyDecision & { action: 'REJECT' | 'THROTTLE' },
    public readonly retryAfterSeconds: number | undefined,
  ) {
    super(decision.reason ?? `Request blocked by policy (${decision.action})`);
    this.name = 'PolicyRejectionError';
  }
}

// --- Evaluation -------------------------------------------------------------

interface MatchedRule {
  rule: PolicyRule;
  metricValue: number | null;
}

function scopeMatches(rule: PolicyRule, ctx: RequestContext): boolean {
  const w = rule.when;
  return (
    matchScopeKey(w.team_id, ctx.team_id) &&
    matchScopeKey(w.feature_id, ctx.feature_id) &&
    matchScopeKey(w.agent_id, ctx.agent_id) &&
    matchScopeKey(w.session_id, ctx.session_id) &&
    matchScopeKey(w.user_id, ctx.user_id)
  );
}

function matchScopeKey(ruleValue: string | undefined, requestValue: string | undefined): boolean {
  if (ruleValue === undefined) return true;
  if (ruleValue === '*') return requestValue !== undefined && requestValue.length > 0;
  return ruleValue === requestValue;
}

export interface LiveMetricOverrides {
  liveSessionTokens?: number;
}

function readMetric(rule: PolicyRule, ctx: RequestContext, live?: LiveMetricOverrides): number {
  if (!rule.if) return 0;
  switch (rule.if.metric) {
    case 'daily_spend_usd':
      return getDailySpendUsd(spendScope(rule, ctx));
    case 'monthly_spend_usd':
      return getMonthlySpendUsd(spendScope(rule, ctx));
    case 'session_request_count':
      return ctx.session_id ? getSessionRequestCount(ctx.session_id) : 0;
    case 'session_total_tokens': {
      const persisted = ctx.session_id ? getSessionTotalTokens(ctx.session_id) : 0;
      return persisted + (live?.liveSessionTokens ?? 0);
    }
    case 'tokens_per_minute':
      return ctx.user_id ? getTokensInLastMinute(ctx.user_id) : 0;
  }
}

function spendScope(rule: PolicyRule, ctx: RequestContext): { team_id?: string; feature_id?: string } {
  // For daily/monthly spend the rule's `when:` declares which slice to sum over.
  // '*' means "any value matches" -> no filter; an explicit literal -> filter to that team/feature.
  const out: { team_id?: string; feature_id?: string } = {};
  if (rule.when.team_id && rule.when.team_id !== '*') out.team_id = rule.when.team_id;
  else if (!rule.when.team_id && ctx.team_id) {
    // No team filter at all in the rule: leave unscoped (global daily spend).
  }
  if (rule.when.feature_id && rule.when.feature_id !== '*') out.feature_id = rule.when.feature_id;
  return out;
}

type CompareOp = z.infer<typeof OpSchema>;

function compare(value: number, op: CompareOp, threshold: number): boolean {
  switch (op) {
    case 'gte': return value >= threshold;
    case 'gt':  return value >  threshold;
    case 'lte': return value <= threshold;
    case 'lt':  return value <  threshold;
    case 'eq':  return value === threshold;
  }
}

function inferProviderFromModel(model: string): Provider {
  if (model.startsWith('claude')) return 'anthropic';
  if (model.startsWith('mock')) return 'mock';
  return 'openai';
}

export function evaluatePolicy(request: GatewayRequest, live?: LiveMetricOverrides): PolicyDecision {
  const ctx = request.context;
  const matches: MatchedRule[] = [];

  for (const rule of activeRules) {
    if (!scopeMatches(rule, ctx)) continue;
    if (rule.if) {
      const metricValue = readMetric(rule, ctx, live);
      if (!compare(metricValue, rule.if.op, rule.if.value)) continue;
      matches.push({ rule, metricValue });
    } else {
      matches.push({ rule, metricValue: null });
    }
  }

  const rules_evaluated = matches.map((m) => m.rule.id);
  if (matches.length === 0) {
    return { action: 'ALLOW', rules_evaluated };
  }

  // Pick the highest-priority action among matching rules.
  const winner = matches.reduce((best, m) =>
    ACTION_PRIORITY[m.rule.action.type] > ACTION_PRIORITY[best.rule.action.type] ? m : best,
  );
  const action = winner.rule.action.type;

  if (action === 'ALLOW') {
    return { action: 'ALLOW', rules_evaluated };
  }

  if (action === 'REROUTE') {
    // Schema guarantees `to` is present when action.type === 'REROUTE'.
    const target = winner.rule.action.to;
    if (!target) return { action: 'ALLOW', rules_evaluated };
    const provider = target.provider ?? inferProviderFromModel(target.model);
    return {
      action: 'REROUTE',
      rules_evaluated,
      rerouted_model: target.model,
      rerouted_provider: provider,
      reason: winner.rule.action.message ?? `rerouted by rule ${winner.rule.id}`,
    };
  }

  // REJECT or THROTTLE
  const reason = winner.rule.action.message ?? defaultReason(winner);
  return {
    action,
    rules_evaluated,
    reason: `[${winner.rule.id}] ${reason}`,
  };
}

function defaultReason(m: MatchedRule): string {
  if (!m.rule.if || m.metricValue === null) {
    return `blocked by rule ${m.rule.id}`;
  }
  return `${m.rule.if.metric}=${m.metricValue} ${m.rule.if.op} ${m.rule.if.value}`;
}

export function retryAfterSecondsFor(decision: PolicyDecision): number | undefined {
  if (decision.action !== 'THROTTLE') return undefined;
  const ruleId = decision.rules_evaluated.find((id) => {
    const r = activeRules.find((rr) => rr.id === id);
    return r?.action.type === 'THROTTLE';
  });
  const rule = activeRules.find((r) => r.id === ruleId);
  return rule?.action.retry_after_seconds ?? 60;
}
