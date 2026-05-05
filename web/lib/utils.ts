import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

/** Tailwind class merger — same convention as shadcn/SentinelQA. */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Map a 0..1 score to one of the design system's --score-* tokens.
 * Used by every score chip / progress ring / table cell.
 */
export function scoreToken(score: number): string {
  if (score >= 0.95) return 'var(--score-pass)';
  if (score >= 0.8) return 'var(--score-ok)';
  if (score >= 0.6) return 'var(--score-mid)';
  if (score >= 0.4) return 'var(--score-poor)';
  return 'var(--score-fail)';
}

export function pct(score: number, digits = 0): string {
  return `${(score * 100).toFixed(digits)}%`;
}

/** Stable run-style identifier for new evals + cases. */
export function shortId(prefix = 'id'): string {
  const r = Math.random().toString(36).slice(2, 8);
  return `${prefix}_${Date.now().toString(36)}_${r}`;
}
