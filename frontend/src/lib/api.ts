import type {
  CacheStats,
  CostEvent,
  CostsResponse,
  PolicyDoc,
  TimeseriesResponse,
} from '../types';

async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(path, { headers: { Accept: 'application/json' } });
  if (!res.ok) {
    throw new Error(`${path} → ${res.status} ${res.statusText}`);
  }
  return res.json() as Promise<T>;
}

export const api = {
  costs: (params: Record<string, string> = {}) =>
    getJson<CostsResponse>('/costs?' + new URLSearchParams(params).toString()),
  timeseries: (params: { bucket?: 'minute' | 'hour' | 'day' } = {}) =>
    getJson<TimeseriesResponse>(
      '/costs/timeseries?' +
        new URLSearchParams({ bucket: params.bucket ?? 'minute' }).toString(),
    ),
  cacheStats: () => getJson<CacheStats>('/cache/stats'),
  recentEvents: (limit = 50) =>
    getJson<{ events: CostEvent[] }>(`/events?limit=${limit}`).then((r) => r.events),
  policy: () => getJson<PolicyDoc>('/policy'),
  reloadPolicy: async (): Promise<{ reloaded_at: string; rules: number; path: string }> => {
    const res = await fetch('/policy/reload', { method: 'POST' });
    if (!res.ok) throw new Error(`reload → ${res.status}`);
    return res.json();
  },
};
