import { encodingForModel, getEncoding, type Tiktoken } from 'js-tiktoken';
import type { ChatMessage, ContextBudget, GatewayRequest, ProviderUsage, TokenEstimate } from '../types.js';
import { computeCost, getPricing } from '../pricing.js';

let cachedEncoder: Tiktoken | null = null;

function getEncoder(model: string): Tiktoken {
  try {
    // Most modern models map cleanly to o200k_base / cl100k_base.
    return encodingForModel(model as Parameters<typeof encodingForModel>[0]);
  } catch {
    if (!cachedEncoder) cachedEncoder = getEncoding('cl100k_base');
    return cachedEncoder;
  }
}

export function countText(text: string, model: string): number {
  if (!text) return 0;
  return getEncoder(model).encode(text).length;
}

export function countMessages(messages: ChatMessage[], model: string): number {
  // Approximation: per-message overhead of 4 tokens (role + delimiters)
  // plus encoded content. Matches OpenAI's published heuristic well enough
  // for cost projection.
  const enc = getEncoder(model);
  let total = 0;
  for (const m of messages) {
    total += 4 + enc.encode(m.content || '').length;
    if (m.name) total += enc.encode(m.name).length;
  }
  return total + 2; // priming
}

const DEFAULT_OUTPUT_ESTIMATE = 256;

export function estimate(request: GatewayRequest): TokenEstimate {
  const inputTokens = countMessages(request.messages, request.model);
  const estimatedOutput = Math.min(
    request.parameters.max_tokens ?? DEFAULT_OUTPUT_ESTIMATE,
    DEFAULT_OUTPUT_ESTIMATE * 4,
  );
  const { total_cost_usd } = computeCost(
    request.provider,
    request.model,
    inputTokens,
    estimatedOutput,
  );
  return {
    input_tokens: inputTokens,
    estimated_output: estimatedOutput,
    estimated_cost_usd: total_cost_usd,
    context_budget: contextBudget(request.messages, request.model),
  };
}

function contextBudget(messages: ChatMessage[], model: string): ContextBudget {
  const window = getPricing('openai', model).context_window;
  const enc = getEncoder(model);
  const count = (text: string) => (text ? enc.encode(text).length : 0);

  let systemTokens = 0;
  let historyTokens = 0;
  let userTokens = 0;
  const lastIdx = messages.length - 1;
  messages.forEach((m, i) => {
    const t = count(m.content);
    if (m.role === 'system') systemTokens += t;
    else if (i === lastIdx && m.role === 'user') userTokens = t;
    else historyTokens += t;
  });

  const used = systemTokens + historyTokens + userTokens;
  return {
    system_prompt_tokens: systemTokens,
    history_tokens: historyTokens,
    user_input_tokens: userTokens,
    remaining_for_output: Math.max(0, window - used),
    utilization_pct: window === 0 ? 0 : Math.round((used / window) * 1000) / 10,
  };
}

export function captureCost(
  request: GatewayRequest,
  usage: ProviderUsage,
): { input_cost_usd: number; output_cost_usd: number; total_cost_usd: number } {
  return computeCost(request.provider, request.model, usage.input_tokens, usage.output_tokens);
}
