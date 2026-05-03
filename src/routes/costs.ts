import { Router } from 'express';
import { z } from 'zod';
import { queryCosts, queryCostsTimeseries } from '../store/sqlite.js';

const groupSchema = z.enum(['team_id', 'feature_id', 'model', 'provider']);

const querySchema = z.object({
  team_id: z.string().optional(),
  feature_id: z.string().optional(),
  start: z.string().optional(),
  end: z.string().optional(),
  group_by: z
    .string()
    .optional()
    .transform((v) => (v ? v.split(',').map((s) => s.trim()).filter(Boolean) : []))
    .pipe(z.array(groupSchema)),
});

const timeseriesSchema = z.object({
  bucket: z.enum(['minute', 'hour', 'day']).default('minute'),
  team_id: z.string().optional(),
  feature_id: z.string().optional(),
  start: z.string().optional(),
  end: z.string().optional(),
});

export const costsRouter: Router = Router();

costsRouter.get('/costs', (req, res) => {
  const parsed = querySchema.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: { type: 'invalid_request', issues: parsed.error.issues } });
    return;
  }
  const summary = queryCosts({
    team_id: parsed.data.team_id,
    feature_id: parsed.data.feature_id,
    start: parsed.data.start,
    end: parsed.data.end,
    group_by: parsed.data.group_by,
  });
  res.json(summary);
});

costsRouter.get('/costs/timeseries', (req, res) => {
  const parsed = timeseriesSchema.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: { type: 'invalid_request', issues: parsed.error.issues } });
    return;
  }
  const points = queryCostsTimeseries(parsed.data);
  res.json({ bucket: parsed.data.bucket, points });
});
