import { Router } from 'express';
import { getActiveRules, getCacheConfig, reloadPolicy } from '../pipeline/policy.js';

export const policyRouter: Router = Router();

policyRouter.get('/policy', (_req, res) => {
  res.json({
    rules: getActiveRules(),
    cache: getCacheConfig(),
  });
});

policyRouter.post('/policy/reload', (_req, res) => {
  const result = reloadPolicy();
  res.json({
    reloaded_at: new Date().toISOString(),
    rules: result.rules,
    path: result.path,
  });
});
