export type Provider = 'openai' | 'anthropic' | 'mock';
export type Environment = 'development' | 'staging' | 'production';
export type PolicyAction = 'ALLOW' | 'REJECT' | 'THROTTLE' | 'REROUTE';

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  name?: string;
}

export interface ModelParameters {
  max_tokens?: number;
  temperature?: number;
  top_p?: number;
  stop?: string | string[];
  stream?: boolean;
}

export interface RequestContext {
  request_id: string;
  team_id: string;
  feature_id: string;
  agent_id?: string;
  session_id?: string;
  user_id?: string;
  environment: Environment;
}

export interface ContextBudget {
  system_prompt_tokens: number;
  history_tokens: number;
  user_input_tokens: number;
  remaining_for_output: number;
  utilization_pct: number;
}

export interface TokenEstimate {
  input_tokens: number;
  estimated_output: number;
  estimated_cost_usd: number;
  context_budget: ContextBudget;
}

export interface PolicyDecision {
  action: PolicyAction;
  reason?: string;
  rules_evaluated: string[];
  rerouted_model?: string;
  rerouted_provider?: Provider;
}

export interface GatewayRequest {
  context: RequestContext;
  provider: Provider;
  model: string;
  messages: ChatMessage[];
  parameters: ModelParameters;
  estimates?: TokenEstimate;
  policy_decision?: PolicyDecision;
}

export interface ProviderUsage {
  input_tokens: number;
  output_tokens: number;
  total_tokens: number;
  cached_input_tokens?: number;
  reasoning_tokens?: number;
}

export interface ProviderResponse {
  text: string;
  usage: ProviderUsage;
  model: string;
  finish_reason: string;
  raw: unknown;
}

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
  cache_hit_type?: 'exact' | 'semantic';
  cache_savings_usd?: number;
  was_budget_killed?: boolean;
  stream_duration_ms?: number;
}

export interface StreamChunk {
  text: string;
  finish_reason?: string;
  is_final: boolean;
}

export interface CacheEntry {
  cache_key: string;
  feature_id: string;
  model: string;
  response_text: string;
  response_tokens: number;
  original_cost_usd: number;
  embedding: number[];
  created_at: number;
  hit_count: number;
  ttl_seconds: number;
}
