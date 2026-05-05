'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { ScoreChip } from '@/components/ui/score-chip';
import type { RunState } from '@/lib/types/eval';

export default function RunsListPage() {
  const [runs, setRuns] = useState<RunState[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/runs')
      .then((r) => r.json())
      .then((data) => {
        if (cancelled) return;
        setRuns(data.runs ?? []);
        setLoading(false);
      })
      .catch(() => setLoading(false));
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <main className="min-h-screen bg-surface-page">
      <header className="border-b border-border bg-background/60 backdrop-blur sticky top-0 z-10">
        <div className="mx-auto max-w-5xl px-6 h-14 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2 text-sm text-text-secondary hover:text-foreground">
            <ArrowLeft className="h-4 w-4" /> Home
          </Link>
          <h1 className="font-medium tracking-tight">Eval runs</h1>
          <Link href="/runs/new">
            <Button variant="brand" size="sm">
              <Plus className="h-3.5 w-3.5" /> New
            </Button>
          </Link>
        </div>
      </header>

      <div className="mx-auto max-w-5xl px-6 py-8">
        {loading ? (
          <p className="text-text-tertiary text-center py-12">Loading…</p>
        ) : runs.length === 0 ? (
          <Card>
            <CardContent className="p-12 text-center">
              <CardTitle className="text-base mb-2">No runs yet</CardTitle>
              <CardDescription className="mb-4">
                Submit a 20-question eval set against your AI to get started.
              </CardDescription>
              <Link href="/runs/new">
                <Button variant="brand">Start your first run</Button>
              </Link>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-2">
            {runs.map((r) => (
              <Link key={r.run_id} href={`/runs/${r.run_id}`}>
                <Card className="hover:border-ring/40 cursor-pointer">
                  <CardContent className="p-4 flex items-center justify-between">
                    <div>
                      <p className="font-mono text-xs text-text-tertiary">{r.run_id}</p>
                      <p className="text-sm text-text-secondary mt-1">
                        {new Date(r.created_at).toLocaleString()} · {r.status}
                      </p>
                    </div>
                    <div className="flex items-center gap-3">
                      {r.current_score !== undefined && <ScoreChip score={r.current_score} withLabel />}
                      <span className="text-xs text-text-tertiary font-mono">
                        round {r.current_round}
                      </span>
                    </div>
                  </CardContent>
                </Card>
              </Link>
            ))}
          </div>
        )}
      </div>
    </main>
  );
}
