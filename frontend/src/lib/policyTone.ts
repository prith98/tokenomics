import type { PolicyAction } from '../types';

export type Tone = 'green' | 'blue' | 'violet' | 'amber' | 'red' | 'gray';

export const ACTION_TONE: Record<PolicyAction, Tone> = {
  ALLOW: 'green',
  REROUTE: 'violet',
  REJECT: 'red',
  THROTTLE: 'amber',
};

// Static class strings so Tailwind's JIT scanner can pick them up reliably.
export const TONE_TEXT_CLS: Record<Tone, string> = {
  green: 'text-accent-green',
  blue: 'text-accent-blue',
  violet: 'text-accent-violet',
  amber: 'text-accent-amber',
  red: 'text-accent-red',
  gray: 'text-ink-300',
};
