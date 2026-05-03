import { Redis } from 'ioredis';
import { config } from '../config.js';
import { log } from '../log.js';

let client: Redis | null = null;
let available = false;
let probed = false;
let probePromise: Promise<boolean> | null = null;

export function getRedis(): Redis | null {
  if (!config.redisUrl || !config.cacheEnabled) return null;
  if (client) return client;
  client = new Redis(config.redisUrl, {
    lazyConnect: true,
    maxRetriesPerRequest: 1,
    enableOfflineQueue: false,
    retryStrategy: () => null,
  });
  client.on('error', (err) => {
    if (available) log.warn({ err: err.message }, 'redis error — disabling cache');
    available = false;
  });
  return client;
}

export async function isRedisAvailable(): Promise<boolean> {
  if (!config.redisUrl || !config.cacheEnabled) return false;
  if (probed) return available;
  if (probePromise) return probePromise;
  const redis = getRedis();
  if (!redis) return false;
  probePromise = (async () => {
    try {
      await redis.connect();
      await redis.ping();
      available = true;
    } catch (err) {
      available = false;
      log.warn({ err: (err as Error).message }, 'redis unavailable — cache disabled');
    } finally {
      probed = true;
    }
    return available;
  })();
  return probePromise;
}

export function resetRedisForTesting(): void {
  if (client) {
    client.disconnect();
    client = null;
  }
  available = false;
  probed = false;
  probePromise = null;
}
