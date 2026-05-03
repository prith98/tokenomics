import { useState } from 'react';
import { Loader2, Send } from 'lucide-react';
import { Panel } from '../components/Panel';
import { Badge } from '../components/Badge';
import { fmtMs, fmtUsd } from '../lib/format';

const MODELS = [
  'gpt-4o-mini',
  'gpt-4o',
  'claude-haiku-4-5',
  'claude-sonnet-4-5',
  'mock-fast',
] as const;

const PRESETS: Array<{ name: string; team: string; feature: string; model: string; agent?: string; session?: string; user?: string; prompt: string }> = [
  {
    name: 'Plain completion',
    team: 'platform-team',
    feature: 'doc-summarizer',
    model: 'gpt-4o-mini',
    prompt: 'Summarize what an LLM gateway does in two sentences.',
  },
  {
    name: 'Reroute (gpt-4o → haiku)',
    team: 'platform-team',
    feature: 'expensive-classifier',
    model: 'gpt-4o',
    prompt: 'Classify the sentiment: "The product works great!"',
  },
  {
    name: 'Streaming',
    team: 'platform-team',
    feature: 'chat-assistant',
    model: 'gpt-4o-mini',
    prompt: 'Count from one to ten, one number per line.',
  },
  {
    name: 'Cache demo (run twice)',
    team: 'platform-team',
    feature: 'doc-summarizer',
    model: 'gpt-4o-mini',
    prompt: 'What is the capital of France? Answer in one word.',
  },
];

interface ResponseInfo {
  text: string;
  costUsd?: string;
  tokens?: string;
  policyAction?: string;
  provider?: string;
  cacheHit?: string;
  cacheSavings?: string;
  latencyMs?: number;
  finishReason?: string;
  budgetKilled?: boolean;
  errorMessage?: string;
}

export function ChatPlayground(): JSX.Element {
  const [team, setTeam] = useState('platform-team');
  const [feature, setFeature] = useState('doc-summarizer');
  const [agent, setAgent] = useState('');
  const [session, setSession] = useState('');
  const [model, setModel] = useState<string>('gpt-4o-mini');
  const [prompt, setPrompt] = useState('Summarize what an LLM gateway does in two sentences.');
  const [stream, setStream] = useState(true);
  const [busy, setBusy] = useState(false);
  const [resp, setResp] = useState<ResponseInfo | null>(null);

  const applyPreset = (p: (typeof PRESETS)[number]): void => {
    setTeam(p.team);
    setFeature(p.feature);
    setModel(p.model);
    setAgent(p.agent ?? '');
    setSession(p.session ?? '');
    setPrompt(p.prompt);
    if (p.name.toLowerCase().includes('streaming')) setStream(true);
  };

  const send = async (): Promise<void> => {
    if (busy || !prompt.trim()) return;
    setBusy(true);
    setResp({ text: '' });
    const t0 = performance.now();
    try {
      const res = await fetch('/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Gateway-Team': team || 'default',
          'X-Gateway-Feature': feature || 'default',
          ...(agent ? { 'X-Gateway-Agent': agent } : {}),
          ...(session ? { 'X-Gateway-Session': session } : {}),
        },
        body: JSON.stringify({
          model,
          messages: [{ role: 'user', content: prompt }],
          max_tokens: 200,
          stream,
        }),
      });

      const headerInfo: Partial<ResponseInfo> = {
        costUsd: res.headers.get('x-gateway-cost-usd') ?? undefined,
        tokens: res.headers.get('x-gateway-tokens-used') ?? undefined,
        policyAction: res.headers.get('x-gateway-policy-action') ?? undefined,
        provider: res.headers.get('x-gateway-provider') ?? undefined,
        cacheHit: res.headers.get('x-gateway-cache-hit') ?? undefined,
        cacheSavings: res.headers.get('x-gateway-cache-savings-usd') ?? undefined,
      };

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        setResp({
          text: '',
          ...headerInfo,
          errorMessage:
            (err?.error?.message as string | undefined) ?? `HTTP ${res.status} ${res.statusText}`,
        });
        return;
      }

      if (res.headers.get('content-type')?.includes('text/event-stream')) {
        if (!res.body) {
          setResp({ text: '', errorMessage: 'empty response body' });
          return;
        }
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        let text = '';
        let finishReason: string | undefined;
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const events = buffer.split('\n\n');
          buffer = events.pop() ?? '';
          for (const ev of events) {
            const line = ev.split('\n').find((l) => l.startsWith('data: '));
            if (!line) continue;
            const payload = line.slice(6).trim();
            if (payload === '[DONE]') continue;
            try {
              const obj = JSON.parse(payload) as {
                choices?: Array<{ delta?: { content?: string }; finish_reason?: string | null }>;
              };
              const choice = obj.choices?.[0];
              const delta = choice?.delta?.content;
              if (delta) {
                text += delta;
                setResp((prev) => ({ ...(prev ?? { text: '' }), ...headerInfo, text }));
              }
              if (choice?.finish_reason) {
                finishReason = choice.finish_reason;
              }
            } catch {
              // skip malformed
            }
          }
        }
        setResp({
          text,
          ...headerInfo,
          finishReason,
          budgetKilled: finishReason === 'budget_kill',
          latencyMs: performance.now() - t0,
        });
      } else {
        const json = (await res.json()) as {
          choices?: Array<{ message?: { content?: string }; finish_reason?: string }>;
        };
        const text = json.choices?.[0]?.message?.content ?? '';
        setResp({
          text,
          ...headerInfo,
          finishReason: json.choices?.[0]?.finish_reason,
          latencyMs: performance.now() - t0,
        });
      }
    } catch (e) {
      setResp({ text: '', errorMessage: (e as Error).message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Panel
      title="Chat playground"
      subtitle="POSTs to /v1/chat/completions — watch results land in the live feed"
      right={
        <div className="flex items-center gap-1 flex-wrap justify-end">
          {PRESETS.map((p) => (
            <button
              key={p.name}
              onClick={() => applyPreset(p)}
              className="text-[11px] font-mono px-2 py-0.5 rounded border border-white/[0.08] text-ink-300 hover:bg-white/[0.04] hover:text-ink-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-blue/60"
            >
              {p.name}
            </button>
          ))}
        </div>
      }
    >
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-3">
        <LabeledInput label="X-Gateway-Team" value={team} onChange={setTeam} />
        <LabeledInput label="X-Gateway-Feature" value={feature} onChange={setFeature} />
        <LabeledInput label="X-Gateway-Agent (optional)" value={agent} onChange={setAgent} />
        <LabeledInput label="X-Gateway-Session (optional)" value={session} onChange={setSession} />
      </div>

      <div className="grid grid-cols-[1fr_auto] gap-3 mb-3 items-end">
        <div>
          <label className="block text-[10.5px] uppercase tracking-wider text-ink-400 mb-1">
            Model
          </label>
          <select
            value={model}
            onChange={(e) => setModel(e.target.value)}
            className="w-full bg-ink-850 border border-white/[0.08] rounded px-2 py-1.5 font-mono text-sm text-ink-100 focus:outline-none focus:border-accent-blue"
          >
            {MODELS.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
        </div>
        <label className="flex items-center gap-2 text-xs font-mono text-ink-300 select-none pb-1.5">
          <input
            type="checkbox"
            checked={stream}
            onChange={(e) => setStream(e.target.checked)}
            className="accent-accent-blue"
          />
          stream
        </label>
      </div>

      <textarea
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
        rows={3}
        className="w-full bg-ink-850 border border-white/[0.08] rounded px-3 py-2 text-sm text-ink-100 font-mono focus:outline-none focus:border-accent-blue resize-none mb-3"
      />

      <div className="flex items-center justify-between mb-3">
        <div className="text-[11px] text-ink-500 font-mono">
          POST /v1/chat/completions
        </div>
        <button
          onClick={send}
          disabled={busy || !prompt.trim()}
          className="inline-flex items-center gap-2 px-3 py-1.5 rounded bg-accent-blue text-ink-950 font-medium text-sm hover:bg-accent-blue/90 disabled:opacity-40 disabled:cursor-not-allowed focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-blue/60"
        >
          {busy ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <Send className="w-4 h-4" />
          )}
          {busy ? 'sending…' : 'send'}
        </button>
      </div>

      {resp && <ResponseView resp={resp} />}
    </Panel>
  );
}

function LabeledInput({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}): JSX.Element {
  return (
    <label className="block">
      <span className="block text-[10.5px] uppercase tracking-wider text-ink-400 mb-1">
        {label}
      </span>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full bg-ink-850 border border-white/[0.08] rounded px-2 py-1.5 font-mono text-sm text-ink-100 focus:outline-none focus:border-accent-blue"
      />
    </label>
  );
}

function ResponseView({ resp }: { resp: ResponseInfo }): JSX.Element {
  return (
    <div className="rounded-md bg-ink-850 border border-white/[0.06] p-3">
      <div className="flex flex-wrap gap-1.5 mb-2 text-[11px] font-mono">
        {resp.policyAction && (
          <Badge
            tone={
              resp.policyAction === 'REJECT' || resp.policyAction === 'THROTTLE'
                ? 'red'
                : resp.policyAction === 'REROUTE'
                  ? 'violet'
                  : 'green'
            }
          >
            {resp.policyAction}
          </Badge>
        )}
        {resp.provider && <Badge tone="blue">{resp.provider}</Badge>}
        {resp.cacheHit && <Badge tone="violet">cache · {resp.cacheHit}</Badge>}
        {resp.budgetKilled && <Badge tone="red">budget kill</Badge>}
        {resp.costUsd && (
          <Badge tone="gray">cost {fmtUsd(parseFloat(resp.costUsd))}</Badge>
        )}
        {resp.tokens && <Badge tone="gray">{resp.tokens} tok</Badge>}
        {resp.cacheSavings && (
          <Badge tone="green">saved {fmtUsd(parseFloat(resp.cacheSavings))}</Badge>
        )}
        {resp.latencyMs !== undefined && <Badge tone="gray">{fmtMs(resp.latencyMs)}</Badge>}
      </div>
      {resp.errorMessage ? (
        <div className="text-sm text-accent-red font-mono whitespace-pre-wrap break-words">
          {resp.errorMessage}
        </div>
      ) : (
        <div className="text-sm text-ink-100 font-mono whitespace-pre-wrap break-words max-h-48 overflow-auto scrollbar-thin">
          {resp.text || <span className="text-ink-500">…</span>}
        </div>
      )}
    </div>
  );
}
