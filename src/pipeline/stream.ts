import { v7 as uuidv7 } from 'uuid';
import { config } from '../config.js';
import { log } from '../log.js';
import { computeCost } from '../pricing.js';
import { insertCostEvent } from '../store/sqlite.js';
import type { CostEvent, GatewayRequest, StreamChunk } from '../types.js';
import { evaluatePolicy } from './policy.js';
import { getSemanticCache } from './cache.js';

export const BUDGET_KILL_SENTINEL = '__GATEWAY_BUDGET_KILL__';

const CHARS_PER_TOKEN = 4;

export interface StreamPipelineOptions {
  request: GatewayRequest;
  providerStream: AsyncIterable<StreamChunk>;
  startedAt: number;
  gatewayOverheadMs: number;
  originalModel: string;
  originalProvider: string;
}

export async function* interceptStream(opts: StreamPipelineOptions): AsyncIterable<string> {
  const { request, providerStream, startedAt, gatewayOverheadMs, originalModel } = opts;
  const ctx = request.context;
  const streamStart = Date.now();
  let firstChunkAt: number | null = null;
  let chunks = 0;
  let outputCharCount = 0;
  let finishReason: string | undefined;
  let killed = false;
  let accumulated = '';

  const inputTokens = request.estimates?.input_tokens ?? 0;

  try {
    for await (const chunk of providerStream) {
      if (chunk.is_final) {
        finishReason = chunk.finish_reason;
        break;
      }
      if (firstChunkAt === null) firstChunkAt = Date.now();
      if (chunk.text) {
        accumulated += chunk.text;
        outputCharCount += chunk.text.length;
        chunks++;
        yield chunk.text;
      }

      const envOverride = Number(process.env.STREAM_POLICY_CHECK_EVERY);
      const checkEvery = Math.max(
        1,
        Number.isFinite(envOverride) && envOverride > 0 ? envOverride : config.streamPolicyCheckEvery,
      );
      if (chunks > 0 && chunks % checkEvery === 0) {
        const liveOutputTokens = Math.ceil(outputCharCount / CHARS_PER_TOKEN);
        const liveSessionTokens = inputTokens + liveOutputTokens;
        const decision = evaluatePolicy(request, { liveSessionTokens });
        if (decision.action === 'REJECT' || decision.action === 'THROTTLE') {
          killed = true;
          finishReason = 'budget_kill';
          yield BUDGET_KILL_SENTINEL;
          break;
        }
      }
    }
  } catch (err) {
    log.warn(
      { err: (err as Error).message, request_id: ctx.request_id },
      'provider stream errored',
    );
    finishReason = finishReason ?? 'error';
  } finally {
    const outputTokens = Math.ceil(outputCharCount / CHARS_PER_TOKEN);
    const totalTokens = inputTokens + outputTokens;
    const cost = computeCost(request.provider, request.model, inputTokens, outputTokens);
    const now = Date.now();
    const ttftMs = firstChunkAt !== null ? firstChunkAt - streamStart : null;

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
      provider: request.provider,
      model: request.model,
      original_model: request.model !== originalModel ? originalModel : undefined,
      input_tokens: inputTokens,
      output_tokens: outputTokens,
      total_tokens: totalTokens,
      cached_input_tokens: 0,
      reasoning_tokens: 0,
      input_cost_usd: cost.input_cost_usd,
      output_cost_usd: cost.output_cost_usd,
      total_cost_usd: cost.total_cost_usd,
      pricing_version: config.pricingVersion,
      total_latency_ms: now - startedAt,
      ttft_ms: ttftMs,
      gateway_overhead_ms: gatewayOverheadMs,
      policy_action: request.policy_decision?.action ?? 'ALLOW',
      cache_hit: false,
      was_budget_killed: killed,
      stream_duration_ms: now - streamStart,
    };

    try {
      insertCostEvent(costEvent);
    } catch (err) {
      log.error({ err, request_id: ctx.request_id }, 'failed to persist stream cost event');
    }

    if (!killed && accumulated.length > 0 && (finishReason === 'stop' || finishReason === undefined)) {
      getSemanticCache()
        .store(request, accumulated, costEvent)
        .catch((err) => log.warn({ err: err.message }, 'cache store failed (stream)'));
    }
  }
}
