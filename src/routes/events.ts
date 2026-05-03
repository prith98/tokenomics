import { Router } from 'express';
import { z } from 'zod';
import { bus } from '../pipeline/bus.js';
import { queryRecentEvents } from '../store/sqlite.js';
import type { CostEvent } from '../types.js';
import type { PolicyReloadedEvent } from '../pipeline/bus.js';

const recentQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(500).optional().default(50),
  since: z.string().datetime().optional(),
});

export const eventsRouter: Router = Router();

eventsRouter.get('/events', (req, res) => {
  const parsed = recentQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: { type: 'invalid_request', issues: parsed.error.issues } });
    return;
  }
  const events = queryRecentEvents(parsed.data.limit, parsed.data.since);
  res.json({ events });
});

eventsRouter.get('/events/stream', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  let closed = false;
  const safeWrite = (chunk: string): void => {
    if (closed || res.writableEnded) return;
    try {
      res.write(chunk);
    } catch {
      cleanup();
    }
  };
  const send = (event: string, data: unknown): void => {
    safeWrite(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  const onCost = (event: CostEvent): void => send('cost_event', event);
  const onPolicy = (event: PolicyReloadedEvent): void => send('policy_reloaded', event);
  bus.on('costEvent', onCost);
  bus.on('policyReloaded', onPolicy);

  const heartbeat = setInterval(() => safeWrite(': ping\n\n'), 15_000);

  function cleanup(): void {
    if (closed) return;
    closed = true;
    clearInterval(heartbeat);
    bus.off('costEvent', onCost);
    bus.off('policyReloaded', onPolicy);
  }
  req.on('close', cleanup);
  req.on('aborted', cleanup);
  res.on('error', cleanup);
  res.on('close', cleanup);

  send('hello', { at: new Date().toISOString() });
});
