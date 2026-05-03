import { createHash } from 'node:crypto';
import OpenAI from 'openai';
import { config } from '../config.js';
import { log } from '../log.js';

export const EMBED_DIM = 256;

const memo = new Map<string, number[]>();
let openaiClient: OpenAI | null = null;

function deterministicEmbed(text: string): number[] {
  const out = new Array<number>(EMBED_DIM);
  let buf = createHash('sha256').update(text).digest();
  for (let i = 0; i < EMBED_DIM; i++) {
    if (i > 0 && i % 32 === 0) {
      buf = createHash('sha256').update(buf).digest();
    }
    const byte = buf[i % 32]!;
    out[i] = (byte / 127.5) - 1;
  }
  let norm = 0;
  for (const v of out) norm += v * v;
  norm = Math.sqrt(norm) || 1;
  for (let i = 0; i < EMBED_DIM; i++) out[i] = out[i]! / norm;
  return out;
}

async function realEmbed(text: string): Promise<number[]> {
  if (!openaiClient) openaiClient = new OpenAI({ apiKey: config.openaiApiKey });
  const res = await openaiClient.embeddings.create({
    model: 'text-embedding-3-small',
    input: text,
    dimensions: EMBED_DIM,
  });
  const v = res.data[0]?.embedding;
  if (!v || v.length !== EMBED_DIM) {
    throw new Error(`unexpected embedding length: ${v?.length}`);
  }
  return v;
}

export async function embed(text: string): Promise<number[]> {
  const key = text;
  const hit = memo.get(key);
  if (hit) return hit;

  let vec: number[];
  if (config.mockMode || !config.openaiApiKey) {
    vec = deterministicEmbed(text);
  } else {
    try {
      vec = await realEmbed(text);
    } catch (err) {
      log.warn({ err: (err as Error).message }, 'embedding fallback to deterministic');
      vec = deterministicEmbed(text);
    }
  }
  memo.set(key, vec);
  return vec;
}

export function embeddingToBuffer(v: number[]): Buffer {
  const f = new Float32Array(v);
  return Buffer.from(f.buffer, f.byteOffset, f.byteLength);
}

export function clearEmbeddingCacheForTesting(): void {
  memo.clear();
}
