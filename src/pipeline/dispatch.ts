import { v7 as uuidv7 } from 'uuid';
import { config } from '../config.js';
import { getProvider } from '../providers/factory.js';
import { captureCost, estimate } from './tokens.js';
import { evaluatePolicy, PolicyRejectionError, retryAfterSecondsFor } from './policy.js';
import { getSemanticCache, type CacheHit } from './cache.js';
import { interceptStream } from './stream.js';
import { insertCostEvent } from '../store/sqlite.js';
import { log } from '../log.js';
import type { CostEvent, GatewayRequest, ProviderResponse } from '../types.js';

export type PipelineResult =
  | { type: 'complete'; response: ProviderResponse; costEvent: CostEvent }
  | { type: 'cache'; text: string; costEvent: CostEvent; cacheHit: CacheHit }
  | {
      type: 'stream';
      stream: AsyncIterable<string>;
      requestId: string;
      provider: string;
      model: string;
      policyAction: string;
    };

export async function runPipeline(request: GatewayRequest): Promise<PipelineResult> {
  const t0 = Date.now();
  const ctx = request.context;
  const originalModel = request.model;
  const originalProvider = request.provider;
  const isStream = request.parameters.stream === true;

  request.estimates = estimate(request);

  const decision = evaluatePolicy(request);
  request.policy_decision = decision;

  if (decision.action === 'REJECT' || decision.action === 'THROTTLE') {
    const rejectionEvent: CostEvent = {
      event_id: uuidv7(),
      request_id: ctx.request_id,
      timestamp: new Date().toISOString(),
      team_id: ctx.team_id,
      feature_id: ctx.feature_id,
      agent_id: ctx.agent_id,
      session_id: ctx.session_id,
      user_id: ctx.user_id,
      environment: ctx.environment,
      provider: originalProvider,
      model: originalModel,
      input_tokens: 0,
      output_tokens: 0,
      total_tokens: 0,
      cached_input_tokens: 0,
      reasoning_tokens: 0,
      input_cost_usd: 0,
      output_cost_usd: 0,
      total_cost_usd: 0,
      pricing_version: config.pricingVersion,
      total_latency_ms: Date.now() - t0,
      ttft_ms: null,
      gateway_overhead_ms: Date.now() - t0,
      policy_action: decision.action,
    };
    try {
      insertCostEvent(rejectionEvent);
    } catch (err) {
      log.error({ err, request_id: ctx.request_id }, 'failed to persist rejection cost event');
    }
    throw new PolicyRejectionError(
      { action: decision.action, reason: decision.reason, rules_evaluated: decision.rules_evaluated },
      retryAfterSecondsFor(decision),
    );
  }

  if (decision.action === 'REROUTE' && decision.rerouted_model && decision.rerouted_provider) {
    request.model = decision.rerouted_model;
    request.provider = decision.rerouted_provider;
    request.estimates = estimate(request);
    log.info(
      {
        request_id: ctx.request_id,
        from_model: originalModel,
        to_model: request.model,
        rules: decision.rules_evaluated,
      },
      'request rerouted by policy',
    );
  }

  const cache = getSemanticCache();
  const cacheHit = await cache.lookup(request).catch((err) => {
    log.warn({ err: err.message }, 'cache lookup threw');
    return null;
  });

  if (cacheHit) {
    const costEvent = buildCacheHitCostEvent(request, cacheHit, originalModel, t0);
    try {
      insertCostEvent(costEvent);
    } catch (err) {
      log.error({ err, request_id: ctx.request_id }, 'failed to persist cache-hit cost event');
    }
    return { type: 'cache', text: cacheHit.response_text, costEvent, cacheHit };
  }

  const tBeforeProvider = Date.now();
  const gatewayOverheadMs = tBeforeProvider - t0;
  const provider = getProvider(request.provider);

  if (isStream) {
    const providerStream = provider.stream(request);
    const stream = interceptStream({
      request,
      providerStream,
      startedAt: t0,
      gatewayOverheadMs,
      originalModel,
      originalProvider,
    });
    return {
      type: 'stream',
      stream,
      requestId: ctx.request_id,
      provider: provider.name,
      model: request.model,
      policyAction: decision.action,
    };
  }

  const response = await provider.complete(request);

  const totalLatencyMs = Date.now() - t0;
  const cost = captureCost(request, response.usage);

  const costEvent: CostEvent = {
    event_id: uuidv7(),
    request_id: ctx.request_id,
    timestamp: new Date().toISOString(),
    team_id: ctx.team_id,
    feature_id: ctx.feature_id,
    agent_id: ctx.agent_id,
    session_id: ctx.session_id,
    user_id: ctx.user_id,
    environment: ctx.environment,
    provider: provider.name,
    model: request.model,
    original_model: request.model !== originalModel ? originalModel : undefined,
    input_tokens: response.usage.input_tokens,
    output_tokens: response.usage.output_tokens,
    total_tokens: response.usage.total_tokens,
    cached_input_tokens: response.usage.cached_input_tokens ?? 0,
    reasoning_tokens: response.usage.reasoning_tokens ?? 0,
    input_cost_usd: cost.input_cost_usd,
    output_cost_usd: cost.output_cost_usd,
    total_cost_usd: cost.total_cost_usd,
    pricing_version: config.pricingVersion,
    total_latency_ms: totalLatencyMs,
    ttft_ms: null,
    gateway_overhead_ms: gatewayOverheadMs,
    policy_action: request.policy_decision.action,
    cache_hit: false,
  };

  try {
    insertCostEvent(costEvent);
  } catch (err) {
    log.error({ err, request_id: ctx.request_id }, 'failed to persist cost event');
  }

  cache.store(request, response.text, costEvent).catch((err) =>
    log.warn({ err: err.message }, 'cache store failed'),
  );

  return { type: 'complete', response, costEvent };
}

function buildCacheHitCostEvent(
  request: GatewayRequest,
  hit: CacheHit,
  originalModel: string,
  startedAt: number,
): CostEvent {
  const ctx = request.context;
  const now = Date.now();
  return {
    event_id: uuidv7(),
    request_id: ctx.request_id,
    timestamp: new Date().toISOString(),
    team_id: ctx.team_id,
    feature_id: ctx.feature_id,
    agent_id: ctx.agent_id,
    session_id: ctx.session_id,
    user_id: ctx.user_id,
    environment: ctx.environment,
    provider: request.provider,
    model: request.model,
    original_model: request.model !== originalModel ? originalModel : undefined,
    input_tokens: 0,
    output_tokens: 0,
    total_tokens: 0,
    cached_input_tokens: 0,
    reasoning_tokens: 0,
    input_cost_usd: 0,
    output_cost_usd: 0,
    total_cost_usd: 0,
    pricing_version: config.pricingVersion,
    total_latency_ms: now - startedAt,
    ttft_ms: null,
    gateway_overhead_ms: now - startedAt,
    policy_action: request.policy_decision?.action ?? 'ALLOW',
    cache_hit: true,
    cache_hit_type: hit.hit_type,
    cache_savings_usd: hit.savings_usd,
  };
}
