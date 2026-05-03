import { Activity, Zap } from 'lucide-react';

interface Props {
  connected: boolean;
}

export function Header({ connected }: Props): JSX.Element {
  return (
    <header className="flex items-center justify-between px-6 py-4 border-b border-white/[0.06] bg-ink-950/80 backdrop-blur sticky top-0 z-10">
      <div className="flex items-center gap-3">
        <div className="w-8 h-8 rounded-md bg-gradient-to-br from-accent-blue to-accent-violet grid place-items-center shadow-lg shadow-accent-violet/20">
          <Zap className="w-4 h-4 text-ink-950" strokeWidth={2.5} />
        </div>
        <div>
          <div className="font-semibold text-ink-100 leading-tight">tokenomics</div>
          <div className="text-[11px] text-ink-400 leading-tight">
            LLM Gateway · live demo
          </div>
        </div>
      </div>

      <div className="flex items-center gap-4 text-xs font-mono text-ink-300">
        <span className="flex items-center gap-2">
          <span
            className={`inline-block w-2 h-2 rounded-full ${
              connected ? 'bg-accent-green pulse-dot' : 'bg-accent-red'
            }`}
          />
          <span className={connected ? 'text-accent-green' : 'text-accent-red'}>
            {connected ? 'live' : 'disconnected'}
          </span>
        </span>
        <span className="hidden md:flex items-center gap-1 text-ink-400">
          <Activity className="w-3.5 h-3.5" />
          <span>SSE</span>
        </span>
      </div>
    </header>
  );
}
