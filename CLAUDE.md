# tokenomics — Claude Code Notes

LLM Gateway: Express + TypeScript proxy in front of OpenAI/Anthropic with policy
engine, semantic cache, and SQLite cost ledger. React+Vite SPA in `frontend/`
serves an admin dashboard from the same Express process.

## Commands

```bash
npm run dev              # backend hot-reload (tsx watch src/index.ts)
npm run dev:frontend     # Vite dev server for SPA (separate process)
npm test                 # vitest run — uses mock provider, no API key/Redis needed
npm run typecheck        # tsc --noEmit on root AND frontend
npm run build            # tsc + frontend Vite build → dist/public
npm run docker:up        # Redis Stack on :6379 + RedisInsight on :8001
./scripts/demo.sh        # end-to-end demo against running gateway
```

Run a single test file: `npx vitest run test/p2.smoke.test.ts`.

## Architecture

- **Pipeline** (`src/pipeline/`): request flows `enrich → policy → cache → provider → tokens` then writes a `CostEvent` to SQLite. `dispatch.ts` orchestrates; `stream.ts` wraps SSE with mid-stream budget kill.
- **Policy** (`src/pipeline/policy.ts`): `policy.yaml` is hot-reloaded via `fs.watch` (~100ms). Started from `src/index.ts` *before* `buildApp()`.
- **Cache** (`src/pipeline/cache.ts`): two-tier — SHA-256 exact match, then Redis Stack HNSW KNN over OpenAI embeddings. Silently degrades if `REDIS_URL` is unset or Redis is down.
- **Routes** (`src/routes/`): `chat`, `costs`, `cache`, `events` (SSE bus), `policy`. All mounted in `server.ts`.
- **Frontend**: built to `dist/public/`, served by Express via `resolveStaticDir()` in `server.ts`. SPA fallback skips paths matching `API_PREFIXES`.

## Gotchas

- **ESM imports use `.js` even for `.ts` source** (`import { x } from './foo.js'`). The project is `"type": "module"` and `tsx`/Node resolve to the compiled name.
- **Two `package.json` roots**: root (backend) and `frontend/`. `npm install` at root does not install frontend deps — use `npm run frontend:install` or `npm run build`.
- **Tests run mock-only by default**. `test/setup.ts` forces mock mode; do not require Redis or `OPENAI_API_KEY` in tests.
- **`better-sqlite3` is a native module** — rebuild on Node version changes (`npm rebuild better-sqlite3`).
- **SQLite WAL files** (`data/gateway.db-shm`, `-wal`) are normal, not stale state.
- **Mid-stream policy kill**: streaming responses can be cut off after first chunks if a budget rule trips post-flight; cost event is still written.

## Key Files

- `src/index.ts` — entrypoint; starts policy watcher, then Express
- `src/server.ts` — app factory, route mounting, SPA static fallback
- `src/config.ts` — typed env config (single source of truth for env vars)
- `src/pricing.ts` — token→USD pricing table (update when adding models)
- `policy.yaml` — live policy rules (hot-reloaded)
- `test/setup.ts` — global test bootstrap (forces mock mode)

## When adding a model

Update `src/pricing.ts` with input/output token rates, and (if new provider) add a provider in `src/providers/` and wire it in `factory.ts`.
