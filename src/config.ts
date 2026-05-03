import 'dotenv/config';
import type { Environment } from './types.js';

function bool(v: string | undefined, fallback: boolean): boolean {
  if (v === undefined) return fallback;
  return v === '1' || v.toLowerCase() === 'true';
}

function num(v: string | undefined, fallback: number): number {
  const n = v === undefined ? NaN : Number(v);
  return Number.isFinite(n) ? n : fallback;
}

const openaiKey = process.env.OPENAI_API_KEY?.trim() || '';

export const config = {
  port: num(process.env.PORT, 8080),
  logLevel: process.env.LOG_LEVEL || 'info',

  mockMode: bool(process.env.MOCK_MODE, openaiKey === ''),
  openaiApiKey: openaiKey,
  mockFailureRate: num(process.env.MOCK_FAILURE_RATE, 0),
  mockStreamDelayMs: num(process.env.MOCK_STREAM_DELAY_MS, 20),

  sqlitePath: process.env.SQLITE_PATH || './data/gateway.db',

  redisUrl: process.env.REDIS_URL?.trim() || '',
  cacheEnabled: bool(process.env.CACHE_ENABLED, true),
  streamPolicyCheckEvery: num(process.env.STREAM_POLICY_CHECK_EVERY, 50),

  defaults: {
    teamId: process.env.DEFAULT_TEAM_ID || 'default',
    featureId: process.env.DEFAULT_FEATURE_ID || 'default',
    environment: (process.env.DEFAULT_ENVIRONMENT || 'development') as Environment,
  },

  pricingVersion: '2026-04-22',
};

export type Config = typeof config;
