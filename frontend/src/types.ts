export type PolicyAction = 'ALLOW' | 'REJECT' | 'THROTTLE' | 'REROUTE';
export type CacheHitType = 'exact' | 'semantic';

export interface CostEvent {
  event_id: string;
  request_id: string;
  timestamp: string;
  team_id: string;
  feature_id: string;
  agent_id?: string;
  session_id?: string;
  user_id?: string;
  environment: string;
  provider: string;
  model: string;
  original_model?: string;
  input_tokens: number;
  output_tokens: number;
  total_tokens: number;
  cached_input_tokens: number;
  reasoning_tokens: number;
  input_cost_usd: number;
  output_cost_usd: number;
  total_cost_usd: number;
  pricing_version: string;
  total_latency_ms: number;
  ttft_ms: number | null;
  gateway_overhead_ms: number;
  policy_action: PolicyAction;
  cache_hit?: boolean;
  cache_hit_type?: CacheHitType;
  cache_savings_usd?: number;
  was_budget_killed?: boolean;
  stream_duration_ms?: number;
}

export interface PolicyReloaded {
  rules: number;
  path: string;
  at: string;
}

export interface CacheStats {
  available: boolean;
  enabled: boolean;
  backend: string;
  stats: {
    total_lookups?: number;
    hits?: number;
    exact_hits: number;
    semantic_hits: number;
    misses: number;
    total_savings_usd: number;
  };
  feature_configs: Record<
    string,
    { enabled: boolean; similarity_threshold: number; ttl_seconds: number }
  >;
}

export interface CostBreakdownRow {
  cost_usd: number;
  tokens: number;
  requests: number;
  team_id?: string;
  feature_id?: string;
  model?: string;
  provider?: string;
}

export interface CostsResponse {
  total_cost_usd: number;
  total_tokens: number;
  total_requests: number;
  breakdown: CostBreakdownRow[];
}

export interface TimeseriesPoint {
  bucket: string;
  cost_usd: number;
  tokens: number;
  requests: number;
  cache_hits: number;
  cache_savings_usd: number;
}

export interface TimeseriesResponse {
  bucket: 'minute' | 'hour' | 'day';
  points: TimeseriesPoint[];
}

export interface PolicyRule {
  id: string;
  description?: string;
  when?: Record<string, string>;
  if?: { metric: string; op: string; value: number };
  action: {
    type: PolicyAction;
    message?: string;
    retry_after_seconds?: number;
    to?: { model: string; provider?: string };
  };
}

export interface PolicyDoc {
  rules: PolicyRule[];
  cache: {
    enabled: boolean;
    backend: string;
    feature_configs: Record<
      string,
      { enabled: boolean; similarity_threshold: number; ttl_seconds: number }
    >;
  };
}
