import { config } from '../config.js';
import { log } from '../log.js';
import type { Provider } from '../types.js';
import { MockProvider } from './mock.js';
import { OpenAIProvider } from './openai.js';
import type { ProviderClient } from './index.js';

let cache: Map<Provider, ProviderClient> | null = null;

export function getProvider(name: Provider): ProviderClient {
  if (!cache) cache = buildProviders();
  const client = cache.get(name);
  if (!client) {
    // Fall back to mock so the gateway is always functional in dev.
    log.warn({ provider: name }, 'unknown provider, falling back to mock');
    return cache.get('mock')!;
  }
  return client;
}

function buildProviders(): Map<Provider, ProviderClient> {
  const m = new Map<Provider, ProviderClient>();
  const mock = new MockProvider({
    failureRate: config.mockFailureRate,
    streamDelayMs: config.mockStreamDelayMs,
  });
  m.set('mock', mock);

  if (config.mockMode) {
    log.info('mock mode active — all providers route to MockProvider');
    m.set('openai', mock);
    m.set('anthropic', mock);
    return m;
  }

  if (config.openaiApiKey) {
    m.set('openai', new OpenAIProvider(config.openaiApiKey));
  } else {
    m.set('openai', mock);
  }
  m.set('anthropic', mock); // not implemented in P1
  return m;
}
