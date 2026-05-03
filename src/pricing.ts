import type { Provider } from './types.js';

export interface ModelPricing {
  input_per_million: number;
  output_per_million: number;
  context_window: number;
}

const TABLE: Record<Provider, Record<string, ModelPricing>> = {
  openai: {
    'gpt-4o': { input_per_million: 2.5, output_per_million: 10, context_window: 128_000 },
    'gpt-4o-mini': { input_per_million: 0.15, output_per_million: 0.6, context_window: 128_000 },
    o3: { input_per_million: 10, output_per_million: 40, context_window: 200_000 },
  },
  anthropic: {
    'claude-opus-4-6': { input_per_million: 15, output_per_million: 75, context_window: 200_000 },
    'claude-sonnet-4-6': { input_per_million: 3, output_per_million: 15, context_window: 200_000 },
    'claude-haiku-4-5': { input_per_million: 0.8, output_per_million: 4, context_window: 200_000 },
  },
  mock: {
    'mock-model': { input_per_million: 1, output_per_million: 2, context_window: 128_000 },
  },
};

const FALLBACK: ModelPricing = {
  input_per_million: 1,
  output_per_million: 2,
  context_window: 128_000,
};

export function getPricing(provider: Provider, model: string): ModelPricing {
  return TABLE[provider]?.[model] ?? FALLBACK;
}

export function computeCost(
  provider: Provider,
  model: string,
  inputTokens: number,
  outputTokens: number,
): { input_cost_usd: number; output_cost_usd: number; total_cost_usd: number } {
  const p = getPricing(provider, model);
  const input_cost_usd = (inputTokens / 1_000_000) * p.input_per_million;
  const output_cost_usd = (outputTokens / 1_000_000) * p.output_per_million;
  return {
    input_cost_usd,
    output_cost_usd,
    total_cost_usd: input_cost_usd + output_cost_usd,
  };
}
