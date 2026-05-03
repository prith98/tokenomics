# tokenomics

> **🌐 Live demo:** **[tokenomics-gateway.fly.dev](https://tokenomics-gateway.fly.dev/)** — open the dashboard, send a chat in the Playground panel, watch cost events stream in live.

A production-grade **LLM Gateway & Control Plane** built in TypeScript. Sits in front of OpenAI and Anthropic APIs to give engineering teams visibility and hard budget controls over every token their products consume.

```
your app  →  tokenomics gateway  →  OpenAI / Anthropic
                    │
                    ├── policy engine   (YAML rules, hot-reload)
                    ├── semantic cache  (Redis vector search)
                    └── cost ledger     (SQLite, queryable API)
```

---

## Why this exists

LLM APIs are expensive and hard to govern at scale. When multiple teams and agents share a single set of API keys, you get:

- No visibility into which feature is burning the budget
- No way to stop a runaway agent loop before it empties the account
- No cache to avoid paying twice for identical queries
- No audit trail when the invoice arrives

This gateway solves all four.

---

## Features

### Policy Engine
Rules are written in YAML and **hot-reloaded** — no restarts required. Every incoming request is evaluated against all matching rules before the provider is called. Four actions are supported:

| Action | Effect |
|---|---|
| `ALLOW` | Explicit pass-through |
| `REJECT` | Returns `429` immediately; cost event still recorded |
| `THROTTLE` | Returns `429` with `Retry-After` header |
| `REROUTE` | Silently swaps model/provider — caller sees no difference |

Rules can match on `team_id`, `feature_id`, `agent_id`, `session_id`, or `user_id` and trigger on metrics including daily/monthly spend, session token totals, request counts, and per-minute token rate.

### Semantic Cache
Two-tier cache with no cold-start penalty:

1. **Exact match** — SHA-256 hash of the full prompt, zero latency
2. **Semantic match** — cosine KNN search via Redis Stack vector index using OpenAI `text-embedding-3-small` embeddings

Threshold and TTL are configurable per `feature_id`. Cache hits return `$0` cost events, with `cache_savings_usd` recorded for visibility.

### Cost Ledger
Every request — including rejections and cache hits — writes a `CostEvent` row to SQLite. Tracked fields: tokens (input/output/cached/reasoning), USD cost, latency (total, TTFT, gateway overhead), policy action, provider, model, and all attribution dimensions.

The `/costs` endpoint lets you slice spend by any combination of team, feature, model, or date range.

### Multi-tenant Attribution
Requests carry lightweight context headers. Policy rules, cost queries, and cache entries are all scoped to these dimensions:

| Header | Dimension |
|---|---|
| `X-Gateway-Team` | `team_id` |
| `X-Gateway-Feature` | `feature_id` |
| `X-Gateway-Agent` | `agent_id` |
| `X-Gateway-Session` | `session_id` |
| `X-Gateway-User` | `user_id` |

---

## Quick Start

### Option A — Docker Compose (recommended)

```bash
git clone <repo>
cd tokenomics

# Copy and configure environment
cp .env.example .env
# Set OPENAI_API_KEY, or leave empty to use the built-in mock provider

# Start everything (app + Redis Stack)
docker compose up --build
```

The gateway is available at `http://localhost:8080`.  
RedisInsight (cache browser) is available at `http://localhost:8001`.

### Option B — Local dev

```bash
npm install

# Start Redis Stack
npm run docker:up

cp .env.example .env
# configure as needed

npm run dev   # hot-reload via tsx watch
```

### Run the demo

```bash
./scripts/demo.sh
```

Walks through all features: basic completion, streaming, policy rerouting, budget rejection, cost analytics, and cache stats.

---

## API Reference

### `POST /v1/chat/completions`

Mirrors the OpenAI Chat Completions API shape. Drop-in compatible with any OpenAI SDK client by changing the `baseURL`.

**Request body**

```json
{
  "model": "gpt-4o-mini",
  "messages": [
    { "role": "system", "content": "You are a concise assistant." },
    { "role": "user",   "content": "Explain LLM gateways in one sentence." }
  ],
  "max_tokens": 100,
  "temperature": 0.7,
  "stream": false
}
```

**Example with OpenAI SDK**

```ts
import OpenAI from 'openai';

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
  baseURL: 'http://localhost:8080/v1',  // point at the gateway
  defaultHeaders: {
    'X-Gateway-Team':    'platform-team',
    'X-Gateway-Feature': 'doc-summarizer',
  },
});

const response = await client.chat.completions.create({
  model: 'gpt-4o-mini',
  messages: [{ role: 'user', content: 'Hello' }],
});
```

**Response headers**

| Header | Description |
|---|---|
| `X-Gateway-Request-Id` | UUID for this request (links to cost event) |
| `X-Gateway-Cost-Usd` | Actual USD cost charged |
| `X-Gateway-Tokens-Used` | Total tokens consumed |
| `X-Gateway-Policy-Action` | `ALLOW`, `REROUTE`, `REJECT`, or `THROTTLE` |
| `X-Gateway-Provider` | Provider that served the response |
| `X-Gateway-Cache-Hit` | `exact` or `semantic` (only on cache hits) |
| `X-Gateway-Cache-Savings-Usd` | USD saved vs. a real API call |

**Error responses**

```json
// 429 — policy rejection
{
  "error": {
    "type": "budget_exceeded",
    "message": "[team-daily-budget] Platform team daily budget of $1.00 exhausted.",
    "rules_evaluated": ["team-daily-budget"]
  }
}

// 429 — throttle
{
  "error": { "type": "rate_limited", "message": "..." }
}
// + Retry-After: 60
```

---

### `GET /costs`

Query aggregated cost events from the SQLite ledger.

**Query parameters**

| Parameter | Description |
|---|---|
| `team_id` | Filter to a specific team |
| `feature_id` | Filter to a specific feature |
| `start` | ISO 8601 timestamp lower bound |
| `end` | ISO 8601 timestamp upper bound |
| `group_by` | Comma-separated: `team_id`, `feature_id`, `model`, `provider` |

**Example**

```bash
curl "http://localhost:8080/costs?team_id=platform-team&group_by=feature_id,model"
```

```json
{
  "total_requests": 42,
  "total_tokens": 18340,
  "total_cost_usd": 0.002751,
  "cache_hits": 7,
  "cache_savings_usd": 0.000462,
  "breakdown": [
    {
      "feature_id": "doc-summarizer",
      "model": "gpt-4o-mini",
      "requests": 28,
      "total_tokens": 12200,
      "total_cost_usd": 0.001830
    }
  ]
}
```

---

### `GET /cache/stats`

Returns live cache hit/miss counters and per-feature configuration.

```bash
curl http://localhost:8080/cache/stats
```

```json
{
  "available": true,
  "enabled": true,
  "backend": "redis",
  "stats": { "hits": 7, "misses": 35, "exact_hits": 2, "semantic_hits": 5 },
  "feature_configs": {
    "doc-summarizer":      { "enabled": true, "similarity_threshold": 0.92, "ttl_seconds": 3600 },
    "expensive-classifier": { "enabled": true, "similarity_threshold": 0.95, "ttl_seconds": 86400 }
  }
}
```

### `GET /healthz`

Returns `{ "ok": true }` when the server is up. Used by Docker and Fly.io health checks.

---

## Policy Configuration

`policy.yaml` is watched with `fs.watch` and reloaded within 100 ms of any change — no restart needed.

```yaml
version: 1

rules:
  # Hard spend cap per team per UTC day
  - id: team-daily-budget
    when:
      team_id: platform-team
    if:
      metric: daily_spend_usd
      op: gte
      value: 1.00
    action:
      type: REJECT
      message: "Platform team daily budget of $1.00 exhausted."

  # Stop runaway agent loops
  - id: agent-iteration-cap
    when:
      agent_id: "*"    # any agent
      session_id: "*"  # that has a session
    if:
      metric: session_request_count
      op: gte
      value: 10
    action:
      type: REJECT
      message: "Agent session exceeded 10-request iteration cap."

  # Force cheap model for cost-sensitive features
  - id: force-haiku-routing
    when:
      feature_id: expensive-classifier
    action:
      type: REROUTE
      to:
        model: claude-haiku-4-5
        provider: anthropic

cache:
  enabled: true
  backend: redis
  feature_configs:
    doc-summarizer:
      enabled: true
      similarity_threshold: 0.92   # cosine similarity cutoff
      ttl_seconds: 3600
    expensive-classifier:
      enabled: true
      similarity_threshold: 0.95
      ttl_seconds: 86400
```

**Available metrics**

| Metric | Description |
|---|---|
| `daily_spend_usd` | Total USD spent today (UTC) for the matched scope |
| `monthly_spend_usd` | Total USD spent this calendar month |
| `session_request_count` | Number of requests in this session |
| `session_total_tokens` | Cumulative tokens in this session |
| `tokens_per_minute` | Token rate for this user in the last 60 s |

**Scope matching**

In `when:`, omit a key to ignore that dimension, use `"*"` to require any non-empty value, or use a literal string for exact match.

---

## Environment Variables

| Variable | Default | Description |
|---|---|---|
| `PORT` | `8080` | HTTP listen port |
| `OPENAI_API_KEY` | — | OpenAI API key (leave empty for mock mode) |
| `REDIS_URL` | — | Redis Stack connection URL |
| `CACHE_ENABLED` | `true` | Enable/disable semantic cache |
| `SQLITE_PATH` | `./data/gateway.db` | SQLite database file path |
| `MOCK_MODE` | `false` | Force mock provider even when API key is set |
| `MOCK_FAILURE_RATE` | `0.0` | Fraction of mock requests that return 500 |
| `LOG_LEVEL` | `info` | Pino log level |
| `POLICY_PATH` | `./policy.yaml` | Path to policy file |
| `DEFAULT_TEAM_ID` | `default` | Fallback team when header is absent |
| `DEFAULT_FEATURE_ID` | `default` | Fallback feature when header is absent |

---

## Deployment

### Fly.io (recommended for demos)

```bash
# Install flyctl, then:
fly auth login
fly launch --no-deploy   # reads fly.toml

# Add Redis Stack (requires Redis Cloud or a second Fly app running redis/redis-stack)
# Set secrets
fly secrets set OPENAI_API_KEY=sk-...
fly secrets set REDIS_URL=redis://...

fly deploy
```

The included `fly.toml` configures:
- A persistent 1 GB volume mounted at `/data` for SQLite
- `shared-cpu-1x` + 512 MB RAM
- HTTPS termination
- Health checks via `/healthz`

### Manual Docker

```bash
docker build -t tokenomics .
docker run -p 8080:8080 \
  -e OPENAI_API_KEY=sk-... \
  -e REDIS_URL=redis://your-redis:6379 \
  -v $(pwd)/data:/data \
  -v $(pwd)/policy.yaml:/app/policy.yaml:ro \
  tokenomics
```

---

## Tech Stack

| Layer | Choice | Why |
|---|---|---|
| Runtime | Node.js 22 + TypeScript | ESM, native `fs.watch`, excellent OpenAI SDK support |
| HTTP | Express 4 | Minimal, well-understood, easy to extend |
| Policy | YAML + Zod | Human-editable rules with schema validation and hot-reload |
| Cache | Redis Stack (HNSW) | Vector KNN search built-in, no separate vector DB needed |
| Persistence | SQLite (WAL mode) | Zero-ops, sufficient for single-node; swap for Postgres when needed |
| Token counting | js-tiktoken | Accurate pre-flight estimates without calling the provider |
| Testing | Vitest + Supertest | Fast, ESM-native, no Jest config overhead |

---

## Running Tests

```bash
npm test
```

Tests run entirely against the mock provider — no API key or Redis required. Three test suites cover the proxy pipeline, policy engine, and semantic cache.

---

## Project Structure

```
src/
├── pipeline/
│   ├── dispatch.ts     # orchestrates the full request pipeline
│   ├── policy.ts       # YAML rule evaluation + hot-reload watcher
│   ├── cache.ts        # two-tier semantic cache (exact + KNN)
│   ├── tokens.ts       # tiktoken estimation + cost capture
│   ├── embeddings.ts   # OpenAI embedding calls for cache lookup
│   ├── enrich.ts       # builds GatewayRequest from Express request
│   └── stream.ts       # SSE wrapper + mid-stream budget kill
├── providers/
│   ├── factory.ts      # returns provider by name
│   ├── openai.ts       # OpenAI complete() + stream()
│   └── mock.ts         # deterministic mock for tests
├── routes/
│   ├── chat.ts         # POST /v1/chat/completions
│   ├── costs.ts        # GET /costs
│   └── cache.ts        # GET /cache/stats
├── store/
│   ├── sqlite.ts       # schema + cost event queries
│   └── redis.ts        # lazy connection + graceful degradation
├── config.ts           # typed config from env vars
├── pricing.ts          # token → USD pricing table
├── types.ts            # shared TypeScript interfaces
└── server.ts           # Express app factory
```
