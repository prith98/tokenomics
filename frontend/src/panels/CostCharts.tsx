import { useMemo, useState } from 'react';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { Panel } from '../components/Panel';
import { Stat } from '../components/Stat';
import { usePolling } from '../hooks/usePolling';
import { api } from '../lib/api';
import { fmtInt, fmtUsd, fmtUsdCompact } from '../lib/format';
import type { CostsResponse, TimeseriesPoint, TimeseriesResponse } from '../types';

type Bucket = 'minute' | 'hour' | 'day';

export function CostCharts(): JSX.Element {
  const [bucket, setBucket] = useState<Bucket>('minute');
  const ts = usePolling<TimeseriesResponse>(() => api.timeseries({ bucket }), 5_000);
  const breakdown = usePolling<CostsResponse>(
    () => api.costs({ group_by: 'feature_id,model' }),
    5_000,
  );
  const fetchError = ts.error ?? breakdown.error;

  const totals = useMemo(() => {
    const points = ts.data?.points ?? [];
    return points.reduce(
      (acc, p) => ({
        cost: acc.cost + p.cost_usd,
        tokens: acc.tokens + p.tokens,
        requests: acc.requests + p.requests,
        cacheHits: acc.cacheHits + p.cache_hits,
        savings: acc.savings + p.cache_savings_usd,
      }),
      { cost: 0, tokens: 0, requests: 0, cacheHits: 0, savings: 0 },
    );
  }, [ts.data]);

  const chartData = useMemo(() => {
    const points = ts.data?.points ?? [];
    return points.map((p: TimeseriesPoint) => ({
      ...p,
      label: bucketLabel(p.bucket, bucket),
      paid: Math.max(p.cost_usd, 0),
      saved: Math.max(p.cache_savings_usd, 0),
    }));
  }, [ts.data, bucket]);

  const breakdownChart = useMemo(() => {
    const rows = breakdown.data?.breakdown ?? [];
    return rows.slice(0, 8).map((r) => ({
      key: `${r.feature_id ?? '·'} · ${r.model ?? '·'}`,
      cost_usd: r.cost_usd,
      requests: r.requests,
    }));
  }, [breakdown.data]);

  const right = (
    <div className="inline-flex rounded border border-white/[0.06] overflow-hidden text-[11px] font-mono">
      {(['minute', 'hour', 'day'] as Bucket[]).map((b) => (
        <button
          key={b}
          onClick={() => setBucket(b)}
          className={`px-2 py-1 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent-blue/60 ${
            bucket === b ? 'bg-white/[0.06] text-ink-100' : 'text-ink-400 hover:text-ink-200'
          }`}
        >
          {b}
        </button>
      ))}
    </div>
  );

  return (
    <Panel title="Cost analytics" subtitle="Spend over time + per-feature breakdown" right={right}>
      {fetchError && (
        <div className="text-xs text-accent-red mb-3">
          cost data unreachable: {fetchError.message}
        </div>
      )}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-5">
        <Stat label="Total spend" value={fmtUsd(totals.cost)} accent="green" />
        <Stat label="Tokens" value={fmtInt(totals.tokens)} accent="blue" />
        <Stat label="Requests" value={fmtInt(totals.requests)} accent="default" />
        <Stat
          label="Cache savings"
          value={fmtUsd(totals.savings)}
          hint={`${totals.cacheHits} hit${totals.cacheHits === 1 ? '' : 's'}`}
          accent="violet"
        />
      </div>

      <div className="h-44 -mx-2">
        {chartData.length > 0 ? (
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={chartData} margin={{ top: 6, right: 12, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id="costGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#5aa9ff" stopOpacity={0.55} />
                  <stop offset="100%" stopColor="#5aa9ff" stopOpacity={0.02} />
                </linearGradient>
                <linearGradient id="saveGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#a584ff" stopOpacity={0.5} />
                  <stop offset="100%" stopColor="#a584ff" stopOpacity={0.02} />
                </linearGradient>
              </defs>
              <CartesianGrid stroke="rgba(255,255,255,0.04)" vertical={false} />
              <XAxis
                dataKey="label"
                tick={{ fontSize: 10, fill: '#8a93a8' }}
                stroke="rgba(255,255,255,0.05)"
                interval="preserveStartEnd"
              />
              <YAxis
                tick={{ fontSize: 10, fill: '#8a93a8' }}
                stroke="rgba(255,255,255,0.05)"
                tickFormatter={(v: number) => fmtUsdCompact(v)}
                width={50}
              />
              <Tooltip
                contentStyle={tooltipStyle}
                labelStyle={{ color: '#b8bfd0' }}
                formatter={(v: number, name: string) => [fmtUsd(v), name === 'paid' ? 'spend' : 'saved by cache']}
              />
              <Area
                type="monotone"
                dataKey="paid"
                stroke="#5aa9ff"
                strokeWidth={1.5}
                fill="url(#costGrad)"
              />
              <Area
                type="monotone"
                dataKey="saved"
                stroke="#a584ff"
                strokeWidth={1.5}
                fill="url(#saveGrad)"
              />
            </AreaChart>
          </ResponsiveContainer>
        ) : (
          <ChartEmpty />
        )}
      </div>

      <div className="mt-5">
        <h3 className="text-[11px] uppercase tracking-wider text-ink-400 mb-2">
          Top feature × model
        </h3>
        <div className="h-40 -mx-2">
          {breakdownChart.length > 0 ? (
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={breakdownChart} layout="vertical" margin={{ top: 0, right: 12, left: 8, bottom: 0 }}>
                <CartesianGrid stroke="rgba(255,255,255,0.04)" horizontal={false} />
                <XAxis
                  type="number"
                  tick={{ fontSize: 10, fill: '#8a93a8' }}
                  stroke="rgba(255,255,255,0.05)"
                  tickFormatter={(v: number) => fmtUsdCompact(v)}
                />
                <YAxis
                  type="category"
                  dataKey="key"
                  tick={{ fontSize: 10, fill: '#b8bfd0' }}
                  stroke="rgba(255,255,255,0.05)"
                  width={150}
                />
                <Tooltip
                  contentStyle={tooltipStyle}
                  formatter={(v: number) => [fmtUsd(v), 'cost']}
                />
                <Bar dataKey="cost_usd" fill="#3ddc84" radius={[0, 3, 3, 0]} />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <ChartEmpty />
          )}
        </div>
      </div>
    </Panel>
  );
}

const tooltipStyle: React.CSSProperties = {
  background: '#11141a',
  border: '1px solid rgba(255,255,255,0.08)',
  borderRadius: 6,
  fontSize: 11,
  fontFamily: 'JetBrains Mono, monospace',
};

function ChartEmpty(): JSX.Element {
  return (
    <div className="h-full grid place-items-center text-xs text-ink-500">
      no data yet · run a request
    </div>
  );
}

function bucketLabel(iso: string, bucket: Bucket): string {
  const d = new Date(iso);
  if (bucket === 'day') {
    return `${String(d.getUTCMonth() + 1).padStart(2, '0')}/${String(d.getUTCDate()).padStart(2, '0')}`;
  }
  if (bucket === 'hour') {
    return `${String(d.getUTCHours()).padStart(2, '0')}:00`;
  }
  return `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`;
}
