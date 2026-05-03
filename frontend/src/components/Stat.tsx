import type { ReactNode } from 'react';

interface Props {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  accent?: 'green' | 'blue' | 'violet' | 'amber' | 'red' | 'default';
}

const ACCENT_CLS: Record<NonNullable<Props['accent']>, string> = {
  green: 'text-accent-green',
  blue: 'text-accent-blue',
  violet: 'text-accent-violet',
  amber: 'text-accent-amber',
  red: 'text-accent-red',
  default: 'text-ink-100',
};

export function Stat({ label, value, hint, accent = 'default' }: Props): JSX.Element {
  return (
    <div className="flex flex-col gap-1">
      <div className="text-[11px] uppercase tracking-wider text-ink-400">{label}</div>
      <div className={`text-2xl font-semibold tabular font-mono ${ACCENT_CLS[accent]}`}>
        {value}
      </div>
      {hint && <div className="text-xs text-ink-400 tabular">{hint}</div>}
    </div>
  );
}
