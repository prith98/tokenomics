import { Header } from './components/Header';
import { useEventStream } from './hooks/useEventStream';
import { CachePanel } from './panels/CachePanel';
import { ChatPlayground } from './panels/ChatPlayground';
import { CostCharts } from './panels/CostCharts';
import { LiveFeed } from './panels/LiveFeed';
import { PolicyPanel } from './panels/PolicyPanel';

export default function App(): JSX.Element {
  const { items, connected } = useEventStream();

  return (
    <div className="min-h-full flex flex-col">
      <Header connected={connected} />

      <main className="flex-1 px-6 py-6 grid gap-4 grid-cols-1 lg:grid-cols-2 xl:grid-cols-3">
        <div className="xl:col-span-2 flex flex-col gap-4">
          <CostCharts />
          <ChatPlayground />
        </div>

        <div className="flex flex-col gap-4 min-h-0">
          <LiveFeed items={items} connected={connected} />
        </div>

        <div className="xl:col-span-2">
          <PolicyPanel />
        </div>
        <div>
          <CachePanel />
        </div>
      </main>

      <footer className="px-6 py-4 text-[11px] text-ink-500 font-mono border-t border-white/[0.04]">
        tokenomics · Express + SQLite + Redis · OpenAI-format proxy with policy + cache + streaming
      </footer>
    </div>
  );
}
