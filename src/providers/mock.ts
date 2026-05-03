import { createHash } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { countText } from '../pipeline/tokens.js';
import type { GatewayRequest, ProviderResponse, StreamChunk } from '../types.js';
import { ProviderError, type ProviderClient } from './index.js';

const CANNED_REPLIES = [
  'Sure — here is a concise answer based on the input you provided.',
  'Based on the context, the most likely answer is the following short summary.',
  'I can help with that. Here is what you should consider as a starting point.',
  'That is a great question. The short version: it depends on a few factors below.',
  'Yes. The simplest path forward is to combine the inputs into a single response.',
];

interface MockOptions {
  failureRate: number; // 0..1
  streamDelayMs: number;
}

export class MockProvider implements ProviderClient {
  readonly name = 'mock';

  constructor(private readonly opts: MockOptions) {}

  async complete(request: GatewayRequest): Promise<ProviderResponse> {
    if (Math.random() < this.opts.failureRate) {
      throw new ProviderError('Injected mock failure', 500, this.name);
    }

    const promptText = request.messages.map((m) => m.content).join('\n');
    const reply = pickReply(promptText, request.parameters.max_tokens ?? 256);

    const inputTokens = countText(promptText, request.model);
    const outputTokens = countText(reply, request.model);

    return {
      text: reply,
      model: request.model,
      finish_reason: 'stop',
      usage: {
        input_tokens: inputTokens,
        output_tokens: outputTokens,
        total_tokens: inputTokens + outputTokens,
      },
      raw: { mock: true },
    };
  }

  async *stream(request: GatewayRequest): AsyncIterable<StreamChunk> {
    if (Math.random() < this.opts.failureRate) {
      throw new ProviderError('Injected mock failure', 500, this.name);
    }
    const promptText = request.messages.map((m) => m.content).join('\n');
    const reply = pickReply(promptText, request.parameters.max_tokens ?? 256);
    const words = reply.split(/(\s+)/).filter((w) => w.length > 0);
    for (const w of words) {
      if (this.opts.streamDelayMs > 0) await delay(this.opts.streamDelayMs);
      yield { text: w, is_final: false };
    }
    yield { text: '', finish_reason: 'stop', is_final: true };
  }
}

function pickReply(prompt: string, maxTokens: number): string {
  const hash = createHash('sha256').update(prompt).digest();
  const base = CANNED_REPLIES[hash[0]! % CANNED_REPLIES.length]!;
  // Append a deterministic suffix so different prompts yield slightly
  // different replies (useful for cache demos in P3).
  const suffix = ` [echo:${hash.slice(0, 4).toString('hex')}]`;
  const out = base + suffix;
  // Roughly cap by max_tokens — 1 token ≈ 4 chars heuristic.
  const charCap = Math.max(40, maxTokens * 4);
  return out.length > charCap ? out.slice(0, charCap) : out;
}
