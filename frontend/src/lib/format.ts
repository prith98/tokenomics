export function fmtUsd(v: number, digits = 6): string {
  if (!Number.isFinite(v)) return '$0.000000';
  if (v === 0) return '$0.' + '0'.repeat(digits);
  const abs = Math.abs(v);
  if (abs >= 1) return `$${v.toFixed(2)}`;
  if (abs >= 0.01) return `$${v.toFixed(4)}`;
  return `$${v.toFixed(digits)}`;
}

export function fmtUsdCompact(v: number): string {
  if (!Number.isFinite(v) || v === 0) return '$0';
  const abs = Math.abs(v);
  if (abs >= 1000) return `$${(v / 1000).toFixed(1)}k`;
  if (abs >= 1) return `$${v.toFixed(2)}`;
  if (abs >= 0.01) return `$${v.toFixed(3)}`;
  return `$${v.toFixed(5)}`;
}

export function fmtInt(v: number): string {
  return v.toLocaleString('en-US');
}

export function fmtMs(v: number | null | undefined): string {
  if (v === null || v === undefined) return '—';
  if (v < 1000) return `${Math.round(v)}ms`;
  return `${(v / 1000).toFixed(2)}s`;
}

export function fmtTime(iso: string): string {
  const d = new Date(iso);
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  const ss = String(d.getSeconds()).padStart(2, '0');
  return `${hh}:${mm}:${ss}`;
}

export function fmtRelative(iso: string, now: number = Date.now()): string {
  const diff = (now - Date.parse(iso)) / 1000;
  if (diff < 1) return 'just now';
  if (diff < 60) return `${Math.floor(diff)}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}
