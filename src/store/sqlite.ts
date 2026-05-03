import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import Database from 'better-sqlite3';
import { config } from '../config.js';
import { log } from '../log.js';
import { bus } from '../pipeline/bus.js';
import type { CostEvent, PolicyAction } from '../types.js';

mkdirSync(dirname(config.sqlitePath), { recursive: true });

export const db = new Database(config.sqlitePath);
db.pragma('journal_mode = WAL');
db.pragma('synchronous = NORMAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS cost_events (
    event_id            TEXT PRIMARY KEY,
    request_id          TEXT NOT NULL,
    timestamp           TEXT NOT NULL,

    team_id             TEXT NOT NULL,
    feature_id          TEXT NOT NULL,
    agent_id            TEXT,
    session_id          TEXT,
    user_id             TEXT,
    environment         TEXT NOT NULL,

    provider            TEXT NOT NULL,
    model               TEXT NOT NULL,
    original_model      TEXT,

    input_tokens        INTEGER NOT NULL,
    output_tokens       INTEGER NOT NULL,
    total_tokens        INTEGER NOT NULL,
    cached_input_tokens INTEGER NOT NULL DEFAULT 0,
    reasoning_tokens    INTEGER NOT NULL DEFAULT 0,

    input_cost_usd      REAL NOT NULL,
    output_cost_usd     REAL NOT NULL,
    total_cost_usd      REAL NOT NULL,
    pricing_version     TEXT NOT NULL,

    total_latency_ms    INTEGER NOT NULL,
    ttft_ms             INTEGER,
    gateway_overhead_ms INTEGER NOT NULL,

    policy_action       TEXT NOT NULL,

    cache_hit           INTEGER NOT NULL DEFAULT 0,
    cache_hit_type      TEXT,
    cache_savings_usd   REAL,
    was_budget_killed   INTEGER NOT NULL DEFAULT 0,
    stream_duration_ms  INTEGER
  );

  CREATE INDEX IF NOT EXISTS idx_cost_events_team_time
    ON cost_events (team_id, timestamp);
  CREATE INDEX IF NOT EXISTS idx_cost_events_feature_time
    ON cost_events (feature_id, timestamp);
  CREATE INDEX IF NOT EXISTS idx_cost_events_session
    ON cost_events (session_id);
  CREATE INDEX IF NOT EXISTS idx_cost_events_user_time
    ON cost_events (user_id, timestamp);
`);

const existingCols = new Set(
  (db.prepare("PRAGMA table_info(cost_events)").all() as { name: string }[]).map((r) => r.name),
);
const columnAdds: Array<[string, string]> = [
  ['cache_hit', 'INTEGER NOT NULL DEFAULT 0'],
  ['cache_hit_type', 'TEXT'],
  ['cache_savings_usd', 'REAL'],
  ['was_budget_killed', 'INTEGER NOT NULL DEFAULT 0'],
  ['stream_duration_ms', 'INTEGER'],
];
for (const [name, def] of columnAdds) {
  if (!existingCols.has(name)) {
    db.exec(`ALTER TABLE cost_events ADD COLUMN ${name} ${def}`);
  }
}

const insertStmt = db.prepare(`
  INSERT INTO cost_events (
    event_id, request_id, timestamp,
    team_id, feature_id, agent_id, session_id, user_id, environment,
    provider, model, original_model,
    input_tokens, output_tokens, total_tokens, cached_input_tokens, reasoning_tokens,
    input_cost_usd, output_cost_usd, total_cost_usd, pricing_version,
    total_latency_ms, ttft_ms, gateway_overhead_ms,
    policy_action,
    cache_hit, cache_hit_type, cache_savings_usd, was_budget_killed, stream_duration_ms
  ) VALUES (
    @event_id, @request_id, @timestamp,
    @team_id, @feature_id, @agent_id, @session_id, @user_id, @environment,
    @provider, @model, @original_model,
    @input_tokens, @output_tokens, @total_tokens, @cached_input_tokens, @reasoning_tokens,
    @input_cost_usd, @output_cost_usd, @total_cost_usd, @pricing_version,
    @total_latency_ms, @ttft_ms, @gateway_overhead_ms,
    @policy_action,
    @cache_hit, @cache_hit_type, @cache_savings_usd, @was_budget_killed, @stream_duration_ms
  )
`);

export function insertCostEvent(event: CostEvent): void {
  insertStmt.run({
    ...event,
    agent_id: event.agent_id ?? null,
    session_id: event.session_id ?? null,
    user_id: event.user_id ?? null,
    original_model: event.original_model ?? null,
    ttft_ms: event.ttft_ms ?? null,
    cache_hit: event.cache_hit ? 1 : 0,
    cache_hit_type: event.cache_hit_type ?? null,
    cache_savings_usd: event.cache_savings_usd ?? null,
    was_budget_killed: event.was_budget_killed ? 1 : 0,
    stream_duration_ms: event.stream_duration_ms ?? null,
  });
  // Listeners must never break the synchronous insert path.
  try {
    bus.emit('costEvent', event);
  } catch (err) {
    log.error({ err }, 'cost_event listener threw');
  }
}

interface RawCostRow {
  event_id: string;
  request_id: string;
  timestamp: string;
  team_id: string;
  feature_id: string;
  agent_id: string | null;
  session_id: string | null;
  user_id: string | null;
  environment: string;
  provider: string;
  model: string;
  original_model: string | null;
  input_tokens: number;
  output_tokens: number;
  total_tokens: number;
  cached_input_tokens: number;
  reasoning_tokens: number;
  input_cost_usd: number;
  output_cost_usd: number;
  total_cost_usd: number;
  pricing_version: string;
  total_latency_ms: number;
  ttft_ms: number | null;
  gateway_overhead_ms: number;
  policy_action: string;
  cache_hit: number;
  cache_hit_type: string | null;
  cache_savings_usd: number | null;
  was_budget_killed: number;
  stream_duration_ms: number | null;
}

function rowToCostEvent(r: RawCostRow): CostEvent {
  return {
    event_id: r.event_id,
    request_id: r.request_id,
    timestamp: r.timestamp,
    team_id: r.team_id,
    feature_id: r.feature_id,
    agent_id: r.agent_id ?? undefined,
    session_id: r.session_id ?? undefined,
    user_id: r.user_id ?? undefined,
    environment: r.environment,
    provider: r.provider,
    model: r.model,
    original_model: r.original_model ?? undefined,
    input_tokens: r.input_tokens,
    output_tokens: r.output_tokens,
    total_tokens: r.total_tokens,
    cached_input_tokens: r.cached_input_tokens,
    reasoning_tokens: r.reasoning_tokens,
    input_cost_usd: r.input_cost_usd,
    output_cost_usd: r.output_cost_usd,
    total_cost_usd: r.total_cost_usd,
    pricing_version: r.pricing_version,
    total_latency_ms: r.total_latency_ms,
    ttft_ms: r.ttft_ms,
    gateway_overhead_ms: r.gateway_overhead_ms,
    policy_action: r.policy_action as PolicyAction,
    cache_hit: r.cache_hit === 1,
    cache_hit_type:
      r.cache_hit_type === 'exact' || r.cache_hit_type === 'semantic' ? r.cache_hit_type : undefined,
    cache_savings_usd: r.cache_savings_usd ?? undefined,
    was_budget_killed: r.was_budget_killed === 1,
    stream_duration_ms: r.stream_duration_ms ?? undefined,
  };
}

export function queryRecentEvents(limit: number, since?: string): CostEvent[] {
  const params: Record<string, string | number> = { limit };
  let sql = 'SELECT * FROM cost_events';
  if (since) {
    sql += ' WHERE timestamp > @since';
    params.since = since;
  }
  sql += ' ORDER BY timestamp DESC, event_id DESC LIMIT @limit';
  const rows = db.prepare(sql).all(params) as RawCostRow[];
  return rows.map(rowToCostEvent);
}

export type TimeseriesBucket = 'minute' | 'hour' | 'day';

export interface TimeseriesPoint {
  bucket: string;
  cost_usd: number;
  tokens: number;
  requests: number;
  cache_hits: number;
  cache_savings_usd: number;
}

export interface TimeseriesQuery {
  bucket: TimeseriesBucket;
  team_id?: string;
  feature_id?: string;
  start?: string;
  end?: string;
}

const BUCKET_FORMATS: Record<TimeseriesBucket, string> = {
  minute: '%Y-%m-%dT%H:%M:00.000Z',
  hour: '%Y-%m-%dT%H:00:00.000Z',
  day: '%Y-%m-%dT00:00:00.000Z',
};

export function queryCostsTimeseries(q: TimeseriesQuery): TimeseriesPoint[] {
  const fmt = BUCKET_FORMATS[q.bucket];
  const where: string[] = [];
  const params: Record<string, string> = {};
  if (q.team_id) {
    where.push('team_id = @team_id');
    params.team_id = q.team_id;
  }
  if (q.feature_id) {
    where.push('feature_id = @feature_id');
    params.feature_id = q.feature_id;
  }
  if (q.start) {
    where.push('timestamp >= @start');
    params.start = q.start;
  }
  if (q.end) {
    where.push('timestamp < @end');
    params.end = q.end;
  }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const sql = `
    SELECT
      strftime('${fmt}', timestamp) AS bucket,
      COALESCE(SUM(total_cost_usd), 0)                                   AS cost_usd,
      COALESCE(SUM(total_tokens), 0)                                     AS tokens,
      COUNT(*)                                                            AS requests,
      COALESCE(SUM(cache_hit), 0)                                        AS cache_hits,
      COALESCE(SUM(CASE WHEN cache_hit = 1 THEN cache_savings_usd ELSE 0 END), 0) AS cache_savings_usd
    FROM cost_events
    ${whereSql}
    GROUP BY bucket
    ORDER BY bucket ASC
  `;
  return db.prepare(sql).all(params) as TimeseriesPoint[];
}

export interface CostQuery {
  team_id?: string;
  feature_id?: string;
  start?: string;
  end?: string;
  group_by?: ReadonlyArray<'team_id' | 'feature_id' | 'model' | 'provider'>;
}

export interface CostBreakdownRow {
  [k: string]: string | number;
  cost_usd: number;
  tokens: number;
  requests: number;
}

export interface CostSummary {
  total_cost_usd: number;
  total_tokens: number;
  total_requests: number;
  breakdown: CostBreakdownRow[];
}

const ALLOWED_GROUPS = new Set(['team_id', 'feature_id', 'model', 'provider']);

export function queryCosts(q: CostQuery = {}): CostSummary {
  const where: string[] = [];
  const params: Record<string, string> = {};
  if (q.team_id) {
    where.push('team_id = @team_id');
    params.team_id = q.team_id;
  }
  if (q.feature_id) {
    where.push('feature_id = @feature_id');
    params.feature_id = q.feature_id;
  }
  if (q.start) {
    where.push('timestamp >= @start');
    params.start = q.start;
  }
  if (q.end) {
    where.push('timestamp < @end');
    params.end = q.end;
  }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

  const totalsRow = db
    .prepare(
      `SELECT
         COALESCE(SUM(total_cost_usd), 0) AS cost_usd,
         COALESCE(SUM(total_tokens), 0)   AS tokens,
         COUNT(*)                          AS requests
       FROM cost_events ${whereSql}`,
    )
    .get(params) as { cost_usd: number; tokens: number; requests: number };

  let breakdown: CostBreakdownRow[] = [];
  if (q.group_by && q.group_by.length > 0) {
    const cols = q.group_by.filter((g) => ALLOWED_GROUPS.has(g));
    if (cols.length > 0) {
      const select = cols.join(', ');
      const sql = `SELECT ${select},
                          SUM(total_cost_usd) AS cost_usd,
                          SUM(total_tokens)   AS tokens,
                          COUNT(*)            AS requests
                   FROM cost_events ${whereSql}
                   GROUP BY ${select}
                   ORDER BY cost_usd DESC`;
      breakdown = db.prepare(sql).all(params) as CostBreakdownRow[];
    }
  }

  return {
    total_cost_usd: totalsRow.cost_usd,
    total_tokens: totalsRow.tokens,
    total_requests: totalsRow.requests,
    breakdown,
  };
}

// --- Metric helpers used by the policy engine ---------------------------------

export interface SpendScope {
  team_id?: string;
  feature_id?: string;
}

function utcDayStartIso(d = new Date()): string {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())).toISOString();
}

function utcMonthStartIso(d = new Date()): string {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)).toISOString();
}

function sumCostSince(since: string, scope: SpendScope): number {
  const where: string[] = ['timestamp >= @since'];
  const params: Record<string, string> = { since };
  if (scope.team_id) {
    where.push('team_id = @team_id');
    params.team_id = scope.team_id;
  }
  if (scope.feature_id) {
    where.push('feature_id = @feature_id');
    params.feature_id = scope.feature_id;
  }
  const row = db
    .prepare(`SELECT COALESCE(SUM(total_cost_usd), 0) AS s FROM cost_events WHERE ${where.join(' AND ')}`)
    .get(params) as { s: number };
  return row.s;
}

export function getDailySpendUsd(scope: SpendScope = {}): number {
  return sumCostSince(utcDayStartIso(), scope);
}

export function getMonthlySpendUsd(scope: SpendScope = {}): number {
  return sumCostSince(utcMonthStartIso(), scope);
}

export function getSessionRequestCount(session_id: string): number {
  const row = db
    .prepare('SELECT COUNT(*) AS c FROM cost_events WHERE session_id = ?')
    .get(session_id) as { c: number };
  return row.c;
}

export function getSessionTotalTokens(session_id: string): number {
  const row = db
    .prepare('SELECT COALESCE(SUM(total_tokens), 0) AS t FROM cost_events WHERE session_id = ?')
    .get(session_id) as { t: number };
  return row.t;
}

export function getTokensInLastMinute(user_id: string): number {
  const since = new Date(Date.now() - 60_000).toISOString();
  const row = db
    .prepare('SELECT COALESCE(SUM(total_tokens), 0) AS t FROM cost_events WHERE user_id = ? AND timestamp >= ?')
    .get(user_id, since) as { t: number };
  return row.t;
}
