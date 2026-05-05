import { cn, scoreToken, pct } from '@/lib/utils';

interface ScoreChipProps {
  score: number;
  className?: string;
  /** Show "passed" / "failed" word + percentage. Default: percentage only. */
  withLabel?: boolean;
}

/**
 * The single canonical way to render a 0..1 score in the UI. Pulls colour
 * from --score-* tokens via scoreToken(). Used in tables, cluster summaries,
 * round-by-round timeline, dashboard tiles.
 */
export function ScoreChip({ score, className, withLabel = false }: ScoreChipProps) {
  const colour = scoreToken(score);
  const label = score >= 0.7 ? 'pass' : 'fail';
  return (
    <span
      className={cn('score-chip', className)}
      style={{
        color: colour,
        borderColor: 'transparent',
        background: `color-mix(in srgb, ${colour} 14%, transparent)`,
      }}
      title={withLabel ? `${pct(score, 1)} (${label})` : `${pct(score, 1)}`}
    >
      {pct(score)}
      {withLabel ? <span className="text-text-tertiary"> · {label}</span> : null}
    </span>
  );
}
