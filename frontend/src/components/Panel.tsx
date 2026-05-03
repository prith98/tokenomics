import type { ReactNode } from 'react';

interface Props {
  title: string;
  subtitle?: string;
  right?: ReactNode;
  className?: string;
  children: ReactNode;
}

export function Panel({ title, subtitle, right, className = '', children }: Props): JSX.Element {
  return (
    <section
      className={`rounded-lg bg-ink-900/70 backdrop-blur shadow-panel border border-white/[0.04] ${className}`}
    >
      <header className="flex items-center justify-between px-4 py-3 border-b border-white/[0.04]">
        <div>
          <h2 className="text-[13px] font-semibold uppercase tracking-wider text-ink-200">
            {title}
          </h2>
          {subtitle && (
            <p className="text-xs text-ink-400 mt-0.5">{subtitle}</p>
          )}
        </div>
        {right && <div className="flex items-center gap-2 text-xs text-ink-300">{right}</div>}
      </header>
      <div className="p-4">{children}</div>
    </section>
  );
}
