import { createHash } from 'node:crypto';
import { log } from '../log.js';
import { getRedis, isRedisAvailable } from '../store/redis.js';
import { getFeatureCacheConfig } from './policy.js';
import { embed, embeddingToBuffer, EMBED_DIM } from './embeddings.js';
import { countText } from './tokens.js';
import type { CacheEntry, CostEvent, GatewayRequest } from '../types.js';

const INDEX_NAME = 'llm_cache_idx';
const KEY_PREFIX = 'cache:';

export interface CacheHit {
  response_text: string;
  hit_type: 'exact' | 'semantic';
  similarity?: number;
  savings_usd: number;
  cache_key: string;
}

export interface CacheStats {
  total_lookups: number;
  exact_hits: number;
  semantic_hits: number;
  misses: number;
  total_savings_usd: number;
}

function lastUserMessage(request: GatewayRequest): string {
  for (let i = request.messages.length - 1; i >= 0; i--) {
    const m = request.messages[i]!;
    if (m.role === 'user') return m.content;
  }
  return '';
}

function systemPrompt(request: GatewayRequest): string {
  return request.messages
    .filter((m) => m.role === 'system')
    .map((m) => m.content)
    .join('');
}

function promptHash(request: GatewayRequest): string {
  const payload = `${systemPrompt(request)}|${lastUserMessage(request)}|${request.model}`;
  return createHash('sha256').update(payload).digest('hex');
}

function entryKey(featureId: string, hash: string): string {
  return `${KEY_PREFIX}${featureId}:${hash}`;
}

export class SemanticCache {
  private indexReady = false;
  private indexInitInflight: Promise<boolean> | null = null;

  private statsState: CacheStats = {
    total_lookups: 0,
    exact_hits: 0,
    semantic_hits: 0,
    misses: 0,
    total_savings_usd: 0,
  };

  async lookup(request: GatewayRequest): Promise<CacheHit | null> {
    const cfg = getFeatureCacheConfig(request.context.feature_id);
    if (!cfg || !cfg.enabled) return null;
    if (!(await isRedisAvailable())) return null;
    if (!(await this.ensureIndex())) return null;

    const redis = getRedis();
    if (!redis) return null;

    this.statsState.total_lookups++;
    const hash = promptHash(request);
    const key = entryKey(request.context.feature_id, hash);

    try {
      const exactRaw = await redis.call('JSON.GET', key);
      if (typeof exactRaw === 'string' && exactRaw.length > 0) {
        const entry = JSON.parse(exactRaw) as CacheEntry;
        await redis.call('JSON.NUMINCRBY', key, '$.hit_count', '1').catch(() => undefined);
        this.statsState.exact_hits++;
        this.statsState.total_savings_usd += entry.original_cost_usd;
        return {
          response_text: entry.response_text,
          hit_type: 'exact',
          savings_usd: entry.original_cost_usd,
          cache_key: entry.cache_key,
        };
      }
    } catch (err) {
      log.warn({ err: (err as Error).message }, 'cache exact lookup failed');
    }

    let semantic: CacheHit | null = null;
    try {
      const vec = await embed(lastUserMessage(request));
      const buf = embeddingToBuffer(vec);
      const featureFilter = `@feature_id:{${escapeTag(request.context.feature_id)}}`;
      const modelFilter = `@model:{${escapeTag(request.model)}}`;
      const query = `${featureFilter} ${modelFilter}=>[KNN 3 @embedding $vec AS score]`;
      const result = (await redis.call(
        'FT.SEARCH',
        INDEX_NAME,
        query,
        'PARAMS',
        '2',
        'vec',
        buf,
        'RETURN',
        '3',
        'score',
        '$.response_text',
        '$.original_cost_usd',
        'SORTBY',
        'score',
        'DIALECT',
        '2',
      )) as unknown[];

      const parsed = parseFtSearch(result);
      const threshold = cfg.similarity_threshold;
      for (const row of parsed) {
        const distance = Number(row.score);
        if (!Number.isFinite(distance)) continue;
        const similarity = 1 - distance;
        if (similarity < threshold) continue;
        const savings = Number(row.original_cost_usd ?? 0);
        semantic = {
          response_text: String(row.response_text ?? ''),
          hit_type: 'semantic',
          similarity,
          savings_usd: Number.isFinite(savings) ? savings : 0,
          cache_key: row.id,
        };
        break;
      }
    } catch (err) {
      log.warn({ err: (err as Error).message }, 'cache semantic lookup failed');
    }

    if (semantic) {
      this.statsState.semantic_hits++;
      this.statsState.total_savings_usd += semantic.savings_usd;
      return semantic;
    }

    this.statsState.misses++;
    return null;
  }

  async store(request: GatewayRequest, responseText: string, costEvent: CostEvent): Promise<void> {
    const cfg = getFeatureCacheConfig(request.context.feature_id);
    if (!cfg || !cfg.enabled) return;
    if (!(await isRedisAvailable())) return;
    if (!(await this.ensureIndex())) return;

    const redis = getRedis();
    if (!redis) return;

    const hash = promptHash(request);
    const key = entryKey(request.context.feature_id, hash);
    const vec = await embed(lastUserMessage(request));

    const entry: CacheEntry = {
      cache_key: key,
      feature_id: request.context.feature_id,
      model: request.model,
      response_text: responseText,
      response_tokens: costEvent.output_tokens || countText(responseText, request.model),
      original_cost_usd: costEvent.total_cost_usd,
      embedding: vec,
      created_at: Date.now(),
      hit_count: 0,
      ttl_seconds: cfg.ttl_seconds,
    };

    try {
      await redis.call('JSON.SET', key, '$', JSON.stringify(entry));
      await redis.expire(key, cfg.ttl_seconds);
    } catch (err) {
      log.warn({ err: (err as Error).message }, 'cache store failed');
    }
  }

  async invalidate(featureId: string): Promise<void> {
    const redis = getRedis();
    if (!redis) return;
    if (!(await isRedisAvailable())) return;
    try {
      const stream = redis.scanStream({ match: `${KEY_PREFIX}${featureId}:*`, count: 100 });
      for await (const keys of stream as AsyncIterable<string[]>) {
        if (keys.length > 0) await redis.del(...keys);
      }
    } catch (err) {
      log.warn({ err: (err as Error).message, featureId }, 'cache invalidate failed');
    }
  }

  stats(): CacheStats {
    return { ...this.statsState };
  }

  resetStatsForTesting(): void {
    this.statsState = {
      total_lookups: 0,
      exact_hits: 0,
      semantic_hits: 0,
      misses: 0,
      total_savings_usd: 0,
    };
    this.indexReady = false;
    this.indexInitInflight = null;
  }

  private async ensureIndex(): Promise<boolean> {
    if (this.indexReady) return true;
    if (this.indexInitInflight) return this.indexInitInflight;
    this.indexInitInflight = (async () => {
      const redis = getRedis();
      if (!redis) return false;
      try {
        await redis.call(
          'FT.CREATE',
          INDEX_NAME,
          'ON',
          'JSON',
          'PREFIX',
          '1',
          KEY_PREFIX,
          'SCHEMA',
          '$.feature_id',
          'AS',
          'feature_id',
          'TAG',
          '$.model',
          'AS',
          'model',
          'TAG',
          '$.embedding',
          'AS',
          'embedding',
          'VECTOR',
          'HNSW',
          '6',
          'TYPE',
          'FLOAT32',
          'DIM',
          String(EMBED_DIM),
          'DISTANCE_METRIC',
          'COSINE',
        );
        log.info({ index: INDEX_NAME }, 'redis vector index created');
        this.indexReady = true;
      } catch (err) {
        const msg = (err as Error).message ?? '';
        if (msg.includes('Index already exists')) {
          this.indexReady = true;
        } else {
          log.warn({ err: msg }, 'redis index create failed — semantic cache disabled');
          return false;
        }
      }
      return this.indexReady;
    })();
    return this.indexInitInflight;
  }
}

function escapeTag(value: string): string {
  return value.replace(/([\\\-\.@,{}|*"'\s])/g, '\\$1');
}

interface FtSearchRow {
  id: string;
  score: string;
  response_text?: string;
  original_cost_usd?: string;
}

function parseFtSearch(reply: unknown[]): FtSearchRow[] {
  const out: FtSearchRow[] = [];
  if (!Array.isArray(reply) || reply.length < 1) return out;
  for (let i = 1; i < reply.length; i += 2) {
    const id = String(reply[i]);
    const fields = reply[i + 1];
    if (!Array.isArray(fields)) continue;
    const row: FtSearchRow = { id, score: '' };
    for (let j = 0; j < fields.length; j += 2) {
      const name = String(fields[j]);
      const value = fields[j + 1] == null ? '' : String(fields[j + 1]);
      if (name === 'score') row.score = value;
      else if (name === '$.response_text') row.response_text = value;
      else if (name === '$.original_cost_usd') row.original_cost_usd = value;
    }
    out.push(row);
  }
  return out;
}

let singleton: SemanticCache | null = null;

export function getSemanticCache(): SemanticCache {
  if (!singleton) singleton = new SemanticCache();
  return singleton;
}

export function resetSemanticCacheForTesting(): void {
  singleton = null;
}
