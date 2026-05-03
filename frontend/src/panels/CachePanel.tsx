import { useMemo } from 'react';
import { Database, ShieldOff } from 'lucide-react';
import { Panel } from '../components/Panel';
import { Stat } from '../components/Stat';
import { Badge } from '../components/Badge';
import { usePolling } from '../hooks/usePolling';
import { api } from '../lib/api';
import { fmtInt, fmtUsd } from '../lib/format';
import type { CacheStats } from '../types';

export function CachePanel(): JSX.Element {
  const { data, error } = usePolling<CacheStats>(() => api.cacheStats(), 5_000);

  const derived = useMemo(() => {
    if (!data) return null;
    const exact = data.stats.exact_hits ?? 0;
    const semantic = data.stats.semantic_hits ?? 0;
    const misses = data.stats.misses ?? 0;
    const lookups = data.stats.total_lookups ?? exact + semantic + misses;
    const hits = exact + semantic;
    const hitRate = lookups > 0 ? hits / lookups : 0;
    return { exact, semantic, misses, lookups, hits, hitRate, savings: data.stats.total_savings_usd ?? 0 };
  }, [data]);

  const right = data ? (
    <div className="flex items-center gap-2">
      <Badge tone={data.available ? 'green' : 'red'}>
        {data.available ? 'redis online' : 'redis offline'}
      </Badge>
      <Badge tone={data.enabled ? 'blue' : 'gray'}>
        {data.enabled ? 'enabled' : 'disabled'}
      </Badge>
    </div>
  ) : null;

  return (
    <Panel
      title="Semantic cache"
      subtitle="Two-tier exact + KNN cache via Redis Stack"
      right={right}
    >
      {error && (
        <div className="text-xs text-accent-red mb-3">cache stats unreachable: {error.message}</div>
      )}
      {!data?.available && data && (
        <div className="rounded-md border border-accent-amber/30 bg-accent-amber/10 px-3 py-2 mb-4 flex items-center gap-2 text-xs text-accent-amber">
          <ShieldOff className="w-3.5 h-3.5" />
          Redis is offline — cache lookups silently bypass. Start it with{' '}
          <code className="font-mono">npm run docker:up</code>.
        </div>
      )}
      {derived && data ? (
        <>
          <div className="grid grid-cols-2 gap-4 mb-5">
            <Stat
              label="Hit rate"
              value={`${(derived.hitRate * 100).toFixed(1)}%`}
              accent="green"
              hint={`${fmtInt(derived.hits)} / ${fmtInt(derived.lookups)} lookups`}
            />
            <Stat
              label="Savings"
              value={fmtUsd(derived.savings)}
              accent="violet"
              hint="vs. paying providers"
            />
          </div>

          <HitBar exact={derived.exact} semantic={derived.semantic} misses={derived.misses} />

          <div className="mt-5">
            <h3 className="text-[11px] uppercase tracking-wider text-ink-400 mb-2">
              Per-feature config
            </h3>
            <div className="space-y-1 max-h-44 overflow-auto scrollbar-thin pr-1">
              {Object.entries(data.feature_configs).map(([feature, cfg]) => (
                <div
                  key={feature}
                  className="flex items-center justify-between py-1.5 px-2 rounded hover:bg-white/[0.02] text-sm"
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <Database className="w-3.5 h-3.5 text-ink-400 shrink-0" />
                    <span className="font-mono truncate">{feature}</span>
                  </div>
                  <div className="flex items-center gap-2 font-mono text-[11px] text-ink-400">
                    <span>thr {cfg.similarity_threshold}</span>
                    <span>·</span>
                    <span>ttl {cfg.ttl_seconds}s</span>
                    <Badge tone={cfg.enabled ? 'green' : 'gray'}>
                      {cfg.enabled ? 'on' : 'off'}
                    </Badge>
                  </div>
                </div>
              ))}
              {Object.keys(data.feature_configs).length === 0 && (
                <div className="text-xs text-ink-500">no feature configs in policy.yaml</div>
              )}
            </div>
          </div>
        </>
      ) : (
        <div className="text-sm text-ink-400">loading…</div>
      )}
    </Panel>
  );
}

function HitBar({
  exact,
  semantic,
  misses,
}: {
  exact: number;
  semantic: number;
  misses: number;
}): JSX.Element {
  const total = exact + semantic + misses;
  if (total === 0) {
    return (
      <div className="rounded bg-white/[0.03] h-2.5 grid place-items-center text-[10px] text-ink-500">
        no lookups yet
      </div>
    );
  }
  const pe = (exact / total) * 100;
  const ps = (semantic / total) * 100;
  const pm = (misses / total) * 100;
  return (
    <div>
      <div className="flex h-2.5 rounded overflow-hidden bg-white/[0.03]">
        <div className="bg-accent-green" style={{ width: `${pe}%` }} title={`exact ${exact}`} />
        <div className="bg-accent-violet" style={{ width: `${ps}%` }} title={`semantic ${semantic}`} />
        <div className="bg-white/[0.05]" style={{ width: `${pm}%` }} title={`miss ${misses}`} />
      </div>
      <div className="mt-2 grid grid-cols-3 gap-2 text-[11px] font-mono text-ink-400">
        <Legend dot="bg-accent-green" label="exact" v={exact} />
        <Legend dot="bg-accent-violet" label="semantic" v={semantic} />
        <Legend dot="bg-white/30" label="miss" v={misses} />
      </div>
    </div>
  );
}

function Legend({ dot, label, v }: { dot: string; label: string; v: number }): JSX.Element {
  return (
    <div className="flex items-center gap-1.5">
      <span className={`inline-block w-1.5 h-1.5 rounded-full ${dot}`} />
      <span>{label}</span>
      <span className="text-ink-200 ml-auto">{fmtInt(v)}</span>
    </div>
  );
}
