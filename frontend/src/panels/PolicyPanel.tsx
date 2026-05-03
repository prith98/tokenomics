import { useState } from 'react';
import { ArrowRight, Ban, Loader2, RefreshCw, Repeat, Timer } from 'lucide-react';
import { Panel } from '../components/Panel';
import { Badge } from '../components/Badge';
import { usePolling } from '../hooks/usePolling';
import { api } from '../lib/api';
import { ACTION_TONE, TONE_TEXT_CLS } from '../lib/policyTone';
import type { PolicyAction, PolicyDoc, PolicyRule } from '../types';

const ACTION_ICON: Record<PolicyAction, typeof Ban> = {
  ALLOW: Repeat,
  REROUTE: ArrowRight,
  REJECT: Ban,
  THROTTLE: Timer,
};

export function PolicyPanel(): JSX.Element {
  const { data, error, refetch } = usePolling<PolicyDoc>(() => api.policy(), 10_000);
  const [reloading, setReloading] = useState(false);
  const [reloadError, setReloadError] = useState<string | null>(null);

  const reload = async (): Promise<void> => {
    setReloading(true);
    setReloadError(null);
    try {
      await api.reloadPolicy();
      refetch();
    } catch (e) {
      setReloadError((e as Error).message);
    } finally {
      setTimeout(() => setReloading(false), 300);
    }
  };

  return (
    <Panel
      title="Policy"
      subtitle="YAML rules · hot-reloaded from disk in <100ms"
      right={
        <button
          onClick={reload}
          disabled={reloading}
          className="inline-flex items-center gap-1.5 px-2 py-1 rounded border border-white/[0.08] text-[11px] font-mono text-ink-300 hover:bg-white/[0.04] hover:text-ink-100 disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-blue/60"
        >
          {reloading ? (
            <Loader2 className="w-3 h-3 animate-spin" />
          ) : (
            <RefreshCw className="w-3 h-3" />
          )}
          reload
        </button>
      }
    >
      {reloadError && (
        <div className="text-xs text-accent-red mb-3">reload failed: {reloadError}</div>
      )}
      {!data && error ? (
        <div className="text-xs text-accent-red">policy unreachable: {error.message}</div>
      ) : !data ? (
        <div className="text-sm text-ink-400">loading…</div>
      ) : (
        <div className="space-y-2 max-h-[420px] overflow-auto scrollbar-thin pr-1">
          {data.rules.length === 0 && (
            <div className="text-xs text-ink-500">no rules — policy.yaml is empty</div>
          )}
          {data.rules.map((rule) => (
            <RuleRow key={rule.id} rule={rule} />
          ))}
        </div>
      )}
    </Panel>
  );
}

function RuleRow({ rule }: { rule: PolicyRule }): JSX.Element {
  const tone = ACTION_TONE[rule.action.type];
  const Icon = ACTION_ICON[rule.action.type];
  const scopeChips = Object.entries(rule.when ?? {}).filter(([, v]) => v != null);

  return (
    <div className="rounded border border-white/[0.05] bg-ink-850/60 p-3">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <Icon className={`w-3.5 h-3.5 ${TONE_TEXT_CLS[tone]} shrink-0`} />
          <span className="font-mono text-sm text-ink-100 truncate">{rule.id}</span>
          <Badge tone={tone}>{rule.action.type}</Badge>
        </div>
      </div>
      {rule.description && (
        <div className="text-xs text-ink-400 mt-1.5">{rule.description}</div>
      )}
      <div className="flex flex-wrap gap-1 mt-2 font-mono text-[10.5px]">
        {scopeChips.map(([k, v]) => (
          <span
            key={k}
            className="px-1.5 py-[1px] rounded bg-white/[0.03] border border-white/[0.05] text-ink-300"
          >
            {k}={v}
          </span>
        ))}
        {rule.if && (
          <span className="px-1.5 py-[1px] rounded bg-accent-blue/[0.08] border border-accent-blue/30 text-accent-blue">
            {rule.if.metric} {opSymbol(rule.if.op)} {rule.if.value}
          </span>
        )}
        {rule.action.to && (
          <span className="px-1.5 py-[1px] rounded bg-accent-violet/[0.08] border border-accent-violet/30 text-accent-violet">
            → {rule.action.to.model}
          </span>
        )}
      </div>
    </div>
  );
}

function opSymbol(op: string): string {
  switch (op) {
    case 'gte':
      return '≥';
    case 'gt':
      return '>';
    case 'lte':
      return '≤';
    case 'lt':
      return '<';
    case 'eq':
      return '=';
    default:
      return op;
  }
}
