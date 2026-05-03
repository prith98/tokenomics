import { useMemo } from 'react';
import { ArrowRight, Database, FileWarning, ShieldAlert, ShieldCheck, Sparkles, Zap } from 'lucide-react';
import { Panel } from '../components/Panel';
import { Badge } from '../components/Badge';
import { fmtMs, fmtTime, fmtUsd } from '../lib/format';
import { ACTION_TONE, TONE_TEXT_CLS } from '../lib/policyTone';
import type { CostEvent } from '../types';
import type { FeedItem } from '../hooks/useEventStream';

interface Props {
  items: FeedItem[];
  connected: boolean;
}

export function LiveFeed({ items, connected }: Props): JSX.Element {
  const right = useMemo(
    () => (
      <span className="font-mono text-[11px]">
        {items.filter((i) => i.kind === 'cost').length} events
      </span>
    ),
    [items],
  );

  return (
    <Panel
      title="Live request feed"
      subtitle="Every cost_event the gateway writes, streamed via SSE"
      right={right}
      className="flex flex-col xl:h-full max-h-[640px] xl:max-h-none"
    >
      <div className="-mx-4 -mb-4 flex-1 min-h-0 overflow-auto scrollbar-thin">
        {items.length === 0 && (
          <div className="px-4 py-10 text-center text-sm text-ink-400">
            {connected
              ? 'Waiting for the first request — try the chat playground →'
              : 'Connecting to gateway…'}
          </div>
        )}
        <ul className="divide-y divide-white/[0.04]">
          {items.map((item, idx) => (
            <FeedRow key={feedKey(item, idx)} item={item} fresh={idx === 0} />
          ))}
        </ul>
      </div>
    </Panel>
  );
}

function feedKey(item: FeedItem, idx: number): string {
  if (item.cost) return `c-${item.cost.event_id}`;
  if (item.policy) return `p-${item.policy.at}`;
  return `s-${item.at}-${idx}`;
}

function FeedRow({ item, fresh }: { item: FeedItem; fresh: boolean }): JSX.Element {
  if (item.kind === 'policy' && item.policy) {
    return (
      <li className={`px-4 py-2.5 flex items-center gap-3 ${fresh ? 'flash-in' : ''}`}>
        <Sparkles className={`w-4 h-4 ${TONE_TEXT_CLS.amber} shrink-0`} />
        <div className="flex-1 min-w-0 text-sm">
          <span className="text-ink-200">policy reloaded</span>
          <span className="text-ink-400 ml-2 font-mono text-xs">
            {item.policy.rules} rule{item.policy.rules === 1 ? '' : 's'} active
          </span>
        </div>
        <span className="font-mono text-[11px] text-ink-400">{fmtTime(item.at)}</span>
      </li>
    );
  }

  if (item.kind === 'system') {
    return (
      <li className="px-4 py-2 flex items-center gap-3 text-xs text-ink-400">
        <span className="inline-block w-1.5 h-1.5 rounded-full bg-accent-blue/60" />
        <span className="flex-1">{item.system}</span>
        <span className="font-mono text-[11px]">{fmtTime(item.at)}</span>
      </li>
    );
  }

  const c = item.cost;
  if (!c) return <li />;
  return <CostRow event={c} fresh={fresh} />;
}

function CostRow({ event: c, fresh }: { event: CostEvent; fresh: boolean }): JSX.Element {
  const tone = ACTION_TONE[c.policy_action];
  const Icon = c.policy_action === 'REJECT' || c.policy_action === 'THROTTLE'
    ? ShieldAlert
    : c.policy_action === 'REROUTE'
      ? ArrowRight
      : c.cache_hit
        ? Database
        : c.was_budget_killed
          ? FileWarning
          : c.policy_action === 'ALLOW'
            ? ShieldCheck
            : Zap;

  return (
    <li className={`px-4 py-2.5 grid grid-cols-[auto_1fr_auto] gap-3 items-center ${fresh ? 'flash-in' : ''}`}>
      <Icon className={`w-4 h-4 ${TONE_TEXT_CLS[tone]} shrink-0`} />
      <div className="min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-mono text-sm text-ink-100 truncate">
            {c.original_model && c.original_model !== c.model ? (
              <>
                <span className="text-ink-400 line-through">{c.original_model}</span>
                <span className="mx-1 text-accent-violet">→</span>
                <span>{c.model}</span>
              </>
            ) : (
              c.model
            )}
          </span>
          <Badge tone={tone}>{c.policy_action}</Badge>
          {c.cache_hit && (
            <Badge tone="blue">cache · {c.cache_hit_type}</Badge>
          )}
          {c.was_budget_killed && <Badge tone="red">budget kill</Badge>}
        </div>
        <div className="flex items-center gap-2 text-[11px] text-ink-400 font-mono mt-0.5 truncate">
          <span className="text-ink-300">{c.team_id}</span>
          <span>·</span>
          <span>{c.feature_id}</span>
          <span>·</span>
          <span>{c.provider}</span>
          {c.session_id && (
            <>
              <span>·</span>
              <span className="truncate">sess:{shortId(c.session_id)}</span>
            </>
          )}
        </div>
      </div>
      <div className="text-right">
        <div className="font-mono tabular text-sm text-ink-100">
          {fmtUsd(c.total_cost_usd)}
        </div>
        <div className="font-mono tabular text-[11px] text-ink-400">
          {c.total_tokens.toLocaleString()} tok · {fmtMs(c.total_latency_ms)}
        </div>
        <div className="font-mono tabular text-[10px] text-ink-500/80 mt-0.5">
          {fmtTime(c.timestamp)}
        </div>
      </div>
    </li>
  );
}

function shortId(s: string): string {
  return s.length > 10 ? s.slice(0, 6) + '…' + s.slice(-3) : s;
}
