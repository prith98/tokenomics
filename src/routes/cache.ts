import { Router } from 'express';
import { getSemanticCache } from '../pipeline/cache.js';
import { getCacheConfig } from '../pipeline/policy.js';
import { isRedisAvailable } from '../store/redis.js';

export const cacheRouter: Router = Router();

cacheRouter.get('/cache/stats', async (_req, res) => {
  const stats = getSemanticCache().stats();
  const cfg = getCacheConfig();
  const available = await isRedisAvailable();
  res.json({
    available,
    enabled: cfg.enabled,
    backend: cfg.backend,
    stats,
    feature_configs: cfg.feature_configs,
  });
});
