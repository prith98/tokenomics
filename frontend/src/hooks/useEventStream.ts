import { useEffect, useRef, useState } from 'react';
import type { CostEvent, PolicyReloaded } from '../types';
import { api } from '../lib/api';

export interface FeedItem {
  kind: 'cost' | 'policy' | 'system';
  at: string;
  cost?: CostEvent;
  policy?: PolicyReloaded;
  system?: string;
}

export interface StreamState {
  items: FeedItem[];
  connected: boolean;
}

const MAX_ITEMS = 200;

export function useEventStream(): StreamState {
  const [items, setItems] = useState<FeedItem[]>([]);
  const [connected, setConnected] = useState(false);
  const seenRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    let cancelled = false;

    // Seed with the most recent persisted events so the feed isn't empty on first load.
    api
      .recentEvents(50)
      .then((events) => {
        if (cancelled) return;
        const seeded: FeedItem[] = events.map((c) => ({
          kind: 'cost',
          at: c.timestamp,
          cost: c,
        }));
        setItems(seeded);
        for (const e of events) seenRef.current.add(e.event_id);
      })
      .catch(() => {
        // fall through; live stream will populate
      });

    const es = new EventSource('/events/stream');
    es.addEventListener('hello', (ev) => {
      if (cancelled) return;
      const { at } = JSON.parse((ev as MessageEvent).data) as { at: string };
      setConnected(true);
      setItems((prev) => [
        { kind: 'system', at, system: 'connected to gateway event stream' },
        ...prev,
      ]);
    });
    es.addEventListener('cost_event', (ev) => {
      if (cancelled) return;
      const cost = JSON.parse((ev as MessageEvent).data) as CostEvent;
      if (seenRef.current.has(cost.event_id)) return;
      seenRef.current.add(cost.event_id);
      setItems((prev) => trim([{ kind: 'cost', at: cost.timestamp, cost }, ...prev]));
    });
    es.addEventListener('policy_reloaded', (ev) => {
      if (cancelled) return;
      const policy = JSON.parse((ev as MessageEvent).data) as PolicyReloaded;
      setItems((prev) => trim([{ kind: 'policy', at: policy.at, policy }, ...prev]));
    });
    es.onerror = () => {
      if (!cancelled) setConnected(false);
    };
    es.onopen = () => {
      if (!cancelled) setConnected(true);
    };

    return () => {
      cancelled = true;
      es.close();
    };
  }, []);

  return { items, connected };
}

function trim(arr: FeedItem[]): FeedItem[] {
  return arr.length > MAX_ITEMS ? arr.slice(0, MAX_ITEMS) : arr;
}
