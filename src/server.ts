import { existsSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { chatRouter } from './routes/chat.js';
import { costsRouter } from './routes/costs.js';
import { cacheRouter } from './routes/cache.js';
import { eventsRouter } from './routes/events.js';
import { policyRouter } from './routes/policy.js';

const API_PREFIXES = [
  '/v1/',
  '/healthz',
  '/costs',
  '/cache/',
  '/events',
  '/policy',
];

function isApiPath(path: string): boolean {
  return API_PREFIXES.some((p) => path === p || path.startsWith(p));
}

function resolveStaticDir(): string | null {
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    resolve(here, '../public'),       // dist/src/server.js -> dist/public
    resolve(here, '../../dist/public'), // src/server.ts (tsx dev) -> dist/public
    resolve(process.cwd(), 'dist/public'),
  ];
  for (const dir of candidates) {
    if (existsSync(dir) && statSync(dir).isDirectory()) return dir;
  }
  return null;
}

export function buildApp(): express.Express {
  const app = express();
  app.use(express.json({ limit: '2mb' }));

  app.get('/healthz', (_req, res) => {
    res.json({ ok: true });
  });

  app.use(chatRouter);
  app.use(costsRouter);
  app.use(cacheRouter);
  app.use(eventsRouter);
  app.use(policyRouter);

  const staticDir = resolveStaticDir();
  if (staticDir) {
    app.use(express.static(staticDir, { index: false, maxAge: '1h' }));
    app.get('*', (req, res, next) => {
      if (isApiPath(req.path)) return next();
      res.sendFile(join(staticDir, 'index.html'));
    });
  }

  return app;
}
