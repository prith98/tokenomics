#!/usr/bin/env bash
# Walks through all major gateway features against a running local instance.
# Usage: ./scripts/demo.sh [BASE_URL]
set -euo pipefail

BASE="${1:-http://localhost:8080}"
BOLD='\033[1m'
CYAN='\033[0;36m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
RED='\033[0;31m'
RESET='\033[0m'

sep() { printf "\n${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}\n"; }
h1()  { printf "\n${BOLD}$*${RESET}\n"; }
ok()  { printf "${GREEN}✓ $*${RESET}\n"; }
info(){ printf "${YELLOW}  $*${RESET}\n"; }

# ── 0. Health check ──────────────────────────────────────────────────────────
sep
h1 "0 · Health check"
HEALTH=$(curl -sf "$BASE/healthz")
echo "$HEALTH" | python3 -m json.tool 2>/dev/null || echo "$HEALTH"
ok "Gateway is up"

# ── 1. Basic chat completion ─────────────────────────────────────────────────
sep
h1 "1 · Basic chat completion (team: platform-team, feature: doc-summarizer)"
RESP=$(curl -sf -X POST "$BASE/v1/chat/completions" \
  -H "Content-Type: application/json" \
  -H "X-Gateway-Team: platform-team" \
  -H "X-Gateway-Feature: doc-summarizer" \
  -D /tmp/gw_headers_1.txt \
  -d '{
    "model": "gpt-4o-mini",
    "messages": [
      {"role": "system", "content": "You are a concise technical assistant."},
      {"role": "user",   "content": "What is an LLM gateway and why would a company need one?"}
    ],
    "max_tokens": 120
  }')

echo "$RESP" | python3 -m json.tool 2>/dev/null || echo "$RESP"
printf "\n"
info "Gateway response headers:"
grep -i "x-gateway" /tmp/gw_headers_1.txt | sed 's/^/    /'
ok "Completion returned — cost + policy action visible in headers"

# ── 2. Streaming response ────────────────────────────────────────────────────
sep
h1 "2 · Streaming (SSE) response"
info "Sending stream: true — server will emit chunked text/event-stream…"
curl -sf -X POST "$BASE/v1/chat/completions" \
  -H "Content-Type: application/json" \
  -H "X-Gateway-Team: platform-team" \
  -H "X-Gateway-Feature: chat-assistant" \
  -d '{
    "model": "gpt-4o-mini",
    "messages": [{"role": "user", "content": "Count from 1 to 5, one word per line."}],
    "max_tokens": 40,
    "stream": true
  }' | head -20
ok "SSE chunks received"

# ── 3. Policy: model reroute ─────────────────────────────────────────────────
sep
h1 "3 · Policy — automatic model reroute"
info "Feature 'expensive-classifier' is configured to reroute → claude-haiku-4-5"
RESP=$(curl -sf -X POST "$BASE/v1/chat/completions" \
  -H "Content-Type: application/json" \
  -H "X-Gateway-Team: platform-team" \
  -H "X-Gateway-Feature: expensive-classifier" \
  -D /tmp/gw_headers_3.txt \
  -d '{
    "model": "gpt-4o",
    "messages": [{"role": "user", "content": "Classify: positive or negative? The product works great!"}],
    "max_tokens": 10
  }')
echo "$RESP" | python3 -m json.tool 2>/dev/null || echo "$RESP"
printf "\n"
grep -i "x-gateway" /tmp/gw_headers_3.txt | sed 's/^/    /'
ok "Request was silently rerouted to cheaper model by policy"

# ── 4. Policy: budget rejection ──────────────────────────────────────────────
sep
h1 "4 · Policy — budget rejection (agent iteration cap)"
info "Agent 'loop-agent' with session 'sess-overflow' — after 10 requests the cap fires"
info "Simulating the 429 response that would be returned once cap is reached:"
HTTP_CODE=$(curl -s -o /tmp/gw_reject.json -w "%{http_code}" -X POST "$BASE/v1/chat/completions" \
  -H "Content-Type: application/json" \
  -H "X-Gateway-Team: platform-team" \
  -H "X-Gateway-Feature: doc-summarizer" \
  -H "X-Gateway-Agent: loop-agent" \
  -H "X-Gateway-Session: sess-$(date +%s)" \
  -d '{
    "model": "gpt-4o-mini",
    "messages": [{"role": "user", "content": "Hello"}],
    "max_tokens": 10
  }')
if [ "$HTTP_CODE" = "429" ]; then
  cat /tmp/gw_reject.json | python3 -m json.tool
  ok "Policy rejected the request (429)"
else
  info "Request allowed (session is fresh — cap not yet reached, HTTP $HTTP_CODE)"
  info "To see a rejection, run 10+ requests with the same session ID"
fi

# ── 5. Cost analytics ────────────────────────────────────────────────────────
sep
h1 "5 · Cost analytics — aggregate spend by feature"
COSTS=$(curl -sf "$BASE/costs?group_by=feature_id,model")
echo "$COSTS" | python3 -m json.tool 2>/dev/null || echo "$COSTS"
ok "Per-feature token and USD cost breakdown from SQLite"

# ── 6. Semantic cache stats ──────────────────────────────────────────────────
sep
h1 "6 · Semantic cache stats"
CACHE=$(curl -sf "$BASE/cache/stats")
echo "$CACHE" | python3 -m json.tool 2>/dev/null || echo "$CACHE"
ok "Cache hit/miss rates and feature-level configuration"

sep
printf "\n${GREEN}${BOLD}Demo complete.${RESET}\n\n"
info "Run the same prompt twice to see a semantic cache hit:"
info "  POST /v1/chat/completions  with X-Gateway-Feature: doc-summarizer"
info "  Watch X-Gateway-Cache-Hit: semantic appear on the second request"
printf "\n"
