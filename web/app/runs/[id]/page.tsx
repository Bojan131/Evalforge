'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { use } from 'react';
import { ArrowLeft, Loader2, AlertCircle, CheckCircle2, FileText } from 'lucide-react';
import { Button } from '@/components/ui/button';
// Button is used via Link → keep import
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { ScoreChip } from '@/components/ui/score-chip';
import { pct } from '@/lib/utils';
import type { RunState } from '@/lib/types/eval';

/**
 * Per-run results page. Polls /api/runs/:id while status is queued/scoring/etc.
 *
 * Layout:
 *   - Top tile: overall score + status + round counter
 *   - Per-case table with score, sub-scores, judge reasoning expander
 *   - (Week 2+) cluster view, patch timeline, before/after diff
 */
export default function RunPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [run, setRun] = useState<RunState | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    async function tick() {
      try {
        const r = await fetch(`/api/runs/${id}`);
        if (!r.ok) {
          setError(r.status === 404 ? 'Run not found' : `Server returned ${r.status}`);
          return;
        }
        const data = (await r.json()) as { run: RunState };
        if (cancelled) return;
        setRun(data.run);
        // Stop polling once we reach a terminal state.
        const terminal = data.run.status === 'done' || data.run.status === 'failed';
        if (!terminal) timer = setTimeout(tick, 1500);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Network error');
      }
    }
    tick();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [id]);

  return (
    <main className="min-h-screen bg-surface-page">
      <header className="border-b border-border bg-background/60 backdrop-blur sticky top-0 z-10">
        <div className="mx-auto max-w-5xl px-6 h-14 flex items-center justify-between">
          <Link href="/runs" className="flex items-center gap-2 text-sm text-text-secondary hover:text-foreground">
            <ArrowLeft className="h-4 w-4" /> All runs
          </Link>
          <h1 className="font-medium tracking-tight">
            <span className="font-mono text-xs text-text-tertiary">{id}</span>
          </h1>
          <Link href={`/runs/${id}/reports`}>
            <Button variant="outline" size="sm">
              <FileText className="h-3.5 w-3.5" /> Reports
            </Button>
          </Link>
        </div>
      </header>

      <div className="mx-auto max-w-5xl px-6 py-8 space-y-6">
        {error && (
          <div className="rounded-md border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive flex items-center gap-2">
            <AlertCircle className="h-4 w-4" />
            {error}
          </div>
        )}

        {!run && !error && (
          <div className="flex items-center justify-center py-24 text-text-tertiary">
            <Loader2 className="h-5 w-5 animate-spin mr-2" /> Loading run…
          </div>
        )}

        {run && (
          <>
            <SummaryTile run={run} />
            {run.status === 'failed' && run.error && (
              <Card>
                <CardHeader>
                  <CardTitle className="text-base text-destructive flex items-center gap-2">
                    <AlertCircle className="h-4 w-4" /> Run failed
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <pre className="text-xs whitespace-pre-wrap text-text-secondary">{run.error}</pre>
                </CardContent>
              </Card>
            )}
            {run.results && <CasesTable run={run} />}
            {run.clusters.length > 0 && <ClustersPreview run={run} />}
          </>
        )}
      </div>
    </main>
  );
}

function SummaryTile({ run }: { run: RunState }) {
  const { status, current_score, initial_score, current_round, goal_score } = run;
  const inProgress = ['queued', 'scoring', 'clustering', 'proposing', 'rescoring'].includes(status);
  const reachedGoal = (current_score ?? 0) >= goal_score;
  return (
    <Card>
      <CardContent className="p-6">
        <div className="flex items-start justify-between">
          <div>
            <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-text-tertiary mb-2">
              Run status
            </p>
            <div className="flex items-center gap-3">
              <h2 className="font-display text-4xl">
                {current_score !== undefined ? pct(current_score, 1) : '—'}
              </h2>
              {current_score !== undefined && <ScoreChip score={current_score} withLabel />}
            </div>
            <p className="mt-2 text-sm text-text-tertiary">
              {initial_score !== undefined && current_score !== undefined && current_round > 1 && (
                <>
                  Started at {pct(initial_score)} · {current_round} round{current_round === 1 ? '' : 's'}
                </>
              )}
              {(current_round === 1 || current_round === 0) && (
                <>Round {current_round || 1} · target {pct(goal_score)}</>
              )}
            </p>
          </div>
          <div>
            {inProgress ? (
              <span className="inline-flex items-center gap-2 text-sm text-text-secondary">
                <Loader2 className="h-4 w-4 animate-spin" />
                {status}
              </span>
            ) : reachedGoal ? (
              <span className="inline-flex items-center gap-2 text-sm text-success">
                <CheckCircle2 className="h-4 w-4" /> goal reached
              </span>
            ) : (
              <span className="inline-flex items-center gap-2 text-sm text-text-tertiary">
                {status}
              </span>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function CasesTable({ run }: { run: RunState }) {
  const cases = run.results?.cases ?? [];
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Per-case scores</CardTitle>
        <CardDescription>
          {cases.length} cases · {cases.filter((c) => c.passed).length} passed ·{' '}
          {cases.filter((c) => !c.passed).length} failed
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-text-tertiary text-xs font-mono uppercase tracking-wider">
                <th className="py-2 pr-3 font-normal">Case</th>
                <th className="py-2 pr-3 font-normal w-24">Score</th>
                <th className="py-2 pr-3 font-normal">Actual</th>
                <th className="py-2 pr-3 font-normal">Why</th>
              </tr>
            </thead>
            <tbody>
              {cases.map((c) => (
                <tr key={c.case_id} className="border-t border-border/60 align-top">
                  <td className="py-3 pr-3 font-mono text-xs text-text-tertiary">{c.case_id}</td>
                  <td className="py-3 pr-3">
                    <ScoreChip score={c.score} />
                  </td>
                  <td className="py-3 pr-3 text-text-secondary">
                    <p className="line-clamp-3">{c.actual || <em className="text-text-tertiary">empty</em>}</p>
                  </td>
                  <td className="py-3 pr-3 text-text-tertiary text-xs">
                    <p className="line-clamp-3">{c.judge_reasoning || c.error || '—'}</p>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}

function ClustersPreview({ run }: { run: RunState }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Failure clusters</CardTitle>
        <CardDescription>Week 2 will replace this stub with embeddings + HDBSCAN.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-2">
        {run.clusters.map((cluster) => (
          <div
            key={cluster.id}
            className="rounded-md border border-border bg-surface-subtle p-3"
          >
            <div className="flex items-center justify-between">
              <h3 className="font-medium text-sm">{cluster.label}</h3>
              <span className="text-xs text-text-tertiary font-mono">
                {cluster.size} case{cluster.size === 1 ? '' : 's'}
              </span>
            </div>
            <p className="text-xs text-text-tertiary mt-1">{cluster.summary}</p>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
