import type { ReactNode } from 'react';

type Tone = 'green' | 'blue' | 'violet' | 'amber' | 'red' | 'gray';

const TONE_CLS: Record<Tone, string> = {
  green: 'bg-accent-green/10 text-accent-green border-accent-green/30',
  blue: 'bg-accent-blue/10 text-accent-blue border-accent-blue/30',
  violet: 'bg-accent-violet/10 text-accent-violet border-accent-violet/30',
  amber: 'bg-accent-amber/10 text-accent-amber border-accent-amber/30',
  red: 'bg-accent-red/10 text-accent-red border-accent-red/30',
  gray: 'bg-white/[0.04] text-ink-200 border-white/[0.08]',
};

interface Props {
  tone?: Tone;
  children: ReactNode;
  className?: string;
}

export function Badge({ tone = 'gray', children, className = '' }: Props): JSX.Element {
  return (
    <span
      className={`inline-flex items-center gap-1 px-1.5 py-[1px] rounded border text-[10.5px] font-mono font-medium uppercase tracking-wide ${TONE_CLS[tone]} ${className}`}
    >
      {children}
    </span>
  );
}
