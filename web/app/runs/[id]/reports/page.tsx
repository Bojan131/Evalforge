'use client';

/**
 * Per-run reports list — one entry per round (0 = baseline, 1+ = patches).
 * Click into one to see the full desci-dkg-style detail.
 */

import { use, useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, FileText, Download } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { ScoreChip } from '@/components/ui/score-chip';
import { pct } from '@/lib/utils';
import type { RunState } from '@/lib/types/eval';

export default function ReportsListPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const [run, setRun] = useState<RunState | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/runs/${id}`)
      .then((r) => r.json())
      .then((d) => {
        if (cancelled) return;
        setRun(d.run ?? null);
        setLoading(false);
      })
      .catch(() => setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [id]);

  return (
    <main className="min-h-screen bg-surface-page">
      <header className="border-b border-border bg-background/60 backdrop-blur sticky top-0 z-10">
        <div className="mx-auto max-w-5xl px-6 h-14 flex items-center justify-between">
          <Link href={`/runs/${id}`} className="flex items-center gap-2 text-sm text-text-secondary hover:text-foreground">
            <ArrowLeft className="h-4 w-4" /> Run
          </Link>
          <h1 className="font-medium tracking-tight">Reports</h1>
          <div className="w-12" />
        </div>
      </header>

      <div className="mx-auto max-w-5xl px-6 py-8 space-y-3">
        {loading && <p className="text-text-tertiary text-center py-12">Loading…</p>}
        {!loading && (!run || run.reports.length === 0) && (
          <Card>
            <CardContent className="p-12 text-center">
              <FileText className="h-8 w-8 text-text-tertiary mx-auto mb-3" />
              <CardTitle className="text-base mb-2">No reports yet</CardTitle>
              <CardDescription>
                Reports appear here as soon as the baseline scoring round finishes.
              </CardDescription>
            </CardContent>
          </Card>
        )}
        {run?.reports
          .slice()
          .sort((a, b) => a.round - b.round)
          .map((r) => (
            <Card key={r.round} className="hover:border-ring/40">
              <CardContent className="p-4 flex items-center justify-between">
                <Link href={`/runs/${id}/reports/${r.round}`} className="flex-1">
                  <div className="flex items-center gap-3">
                    <span className="font-mono text-xs text-text-tertiary w-16">
                      Round {r.round}
                    </span>
                    <div>
                      <p className="text-sm font-medium">{r.label}</p>
                      <p className="text-xs text-text-tertiary mt-0.5">
                        {new Date(r.generated_at).toLocaleString()} ·{' '}
                        {r.results.cases.filter((c) => c.passed).length}/{r.results.cases.length} passed ·{' '}
                        {pct(r.results.pass_rate, 0)} pass rate
                      </p>
                    </div>
                  </div>
                </Link>
                <div className="flex items-center gap-2">
                  <ScoreChip score={r.results.overall_score} withLabel />
                  <a href={`/api/runs/${id}/reports/${r.round}.txt`} title="Download .txt">
                    <Button variant="ghost" size="icon">
                      <Download className="h-3.5 w-3.5" />
                    </Button>
                  </a>
                </div>
              </CardContent>
            </Card>
          ))}
      </div>
    </main>
  );
}
