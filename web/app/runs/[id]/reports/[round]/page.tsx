'use client';

/**
 * Per-round report — the desci-dkg-style detailed answer analysis,
 * rendered as a rich web page. Layout follows the txt export so the
 * customer sees the same structure whether they download or view in-app.
 *
 * Sections (top → bottom):
 *   1. Header tile with overall score + lift vs baseline + judge model
 *   2. Per-question detail cards (question, expected, scores per metric,
 *      actual answer, judge reasoning, "what needs to reach 100%" block)
 *   3. Summary tile with per-metric averages
 *   4. Download .txt button (calls /api/runs/:id/reports/:round.txt)
 */

import { use, useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, Download, Loader2, AlertCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { ScoreChip } from '@/components/ui/score-chip';
import { pct, scoreToken } from '@/lib/utils';
import { RAGAS_METRIC_DISPLAY } from '@/lib/types/eval';
import type { RoundReport, EvalCase, ScoreBatchResponse } from '@/lib/types/eval';

interface ReportPayload {
  report: RoundReport;
  baseline?: RoundReport;
  previous?: RoundReport;
  run_id: string;
}

export default function ReportPage({
  params,
}: {
  params: Promise<{ id: string; round: string }>;
}) {
  const { id, round } = use(params);
  const [data, setData] = useState<ReportPayload | null>(null);
  const [inputCases, setInputCases] = useState<EvalCase[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      fetch(`/api/runs/${id}/reports/${round}`).then((r) => r.json()),
      fetch(`/api/runs/${id}`).then((r) => r.json()),
    ])
      .then(([reportData, runData]) => {
        if (cancelled) return;
        if (reportData.error) {
          setError(reportData.error);
          return;
        }
        setData(reportData);
        setInputCases(runData.run?.input_cases ?? []);
      })
      .catch((e) => setError(e instanceof Error ? e.message : 'Network error'));
    return () => {
      cancelled = true;
    };
  }, [id, round]);

  if (error) {
    return (
      <ReportShell id={id} round={round}>
        <div className="rounded-md border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive flex items-center gap-2">
          <AlertCircle className="h-4 w-4" /> {error}
        </div>
      </ReportShell>
    );
  }

  if (!data) {
    return (
      <ReportShell id={id} round={round}>
        <div className="flex items-center justify-center py-24 text-text-tertiary">
          <Loader2 className="h-5 w-5 animate-spin mr-2" /> Loading report…
        </div>
      </ReportShell>
    );
  }

  const { report, baseline, previous } = data;
  const caseLookup = new Map(inputCases.map((c) => [c.id, c]));
  const baselineLookup = baseline ? new Map(baseline.results.cases.map((c) => [c.case_id, c])) : null;
  const previousLookup = previous ? new Map(previous.results.cases.map((c) => [c.case_id, c])) : null;
  const lift = baseline ? report.results.overall_score - baseline.results.overall_score : 0;

  return (
    <ReportShell id={id} round={round} runId={data.run_id} reportRound={report.round}>
      {/* ── Header tile ── */}
      <Card>
        <CardContent className="p-6 space-y-1">
          <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-text-tertiary">
            EvalForge Evaluation Report — {report.label}
          </p>
          <div className="flex items-baseline gap-3 mt-3">
            <h2 className="font-display text-5xl">{pct(report.results.overall_score, 1)}</h2>
            <ScoreChip score={report.results.overall_score} withLabel />
            {baseline && (
              <span className={`font-mono text-sm ${lift >= 0 ? 'text-success' : 'text-destructive'}`}>
                {lift >= 0 ? '+' : ''}
                {(lift * 100).toFixed(1)}pp vs baseline
              </span>
            )}
          </div>
          <div className="text-sm text-text-tertiary mt-2 flex flex-wrap gap-4">
            <span>📅 {new Date(report.generated_at).toLocaleString()}</span>
            <span>⚖️ Judge: {report.results.judge_model}</span>
            <span>
              🎯 Pass rate: {pct(report.results.pass_rate, 0)} (
              {report.results.cases.filter((c) => c.passed).length}/{report.results.cases.length} passed)
            </span>
          </div>
        </CardContent>
      </Card>

      {/* ── Patch summary if this is a non-baseline round ── */}
      {report.patch_applied && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Patch applied</CardTitle>
            <CardDescription>
              {report.patch_applied.accepted ? '✅ Accepted' : `❌ Rejected — ${report.patch_applied.reject_reason}`}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {report.patch_applied.prompt_diff && (
              <pre className="font-mono text-xs bg-surface-subtle border border-border rounded-md p-3 whitespace-pre-wrap">
                {report.patch_applied.prompt_diff}
              </pre>
            )}
            {report.patch_applied.few_shots_added.length > 0 && (
              <details className="mt-2">
                <summary className="cursor-pointer text-xs text-text-secondary">
                  + {report.patch_applied.few_shots_added.length} few-shot example(s)
                </summary>
                <div className="mt-2 space-y-1">
                  {report.patch_applied.few_shots_added.map((s, i) => (
                    <div key={i} className="text-xs bg-surface-subtle border border-border rounded p-2">
                      <p>
                        <strong>Q:</strong> {s.input}
                      </p>
                      <p className="mt-1">
                        <strong>A:</strong> {s.output}
                      </p>
                    </div>
                  ))}
                </div>
              </details>
            )}
          </CardContent>
        </Card>
      )}

      {/* ── Per-question detail ── */}
      {report.results.cases.map((caseResult, idx) => {
        const original = caseLookup.get(caseResult.case_id);
        const baselineCase = baselineLookup?.get(caseResult.case_id);
        const previousCase = previousLookup?.get(caseResult.case_id);

        return (
          <Card key={caseResult.case_id} className="anim-fade-in">
            <CardHeader>
              <div className="flex items-baseline justify-between">
                <CardTitle className="text-base">
                  <span className="font-mono text-text-tertiary text-xs mr-2">#{String(idx + 1).padStart(2, '0')}</span>
                  Question
                </CardTitle>
                <ScoreChip score={caseResult.score} withLabel />
              </div>
              <CardDescription className="mt-2 text-foreground">
                ❓ {original?.question ?? '(question text not loaded)'}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Expected */}
              <Section emoji="✅" title="Expected answer">
                {original?.expected ?? '(expected text not loaded)'}
              </Section>

              {/* Context (if any) */}
              {original?.context && (
                <Section emoji="📚" title="Context">
                  <span className="text-xs">{original.context.slice(0, 400)}</span>
                </Section>
              )}

              {/* Scores comparison */}
              <div className="border border-border rounded-md p-3 bg-surface-subtle">
                <p className="text-[11px] font-mono uppercase tracking-wider text-text-tertiary mb-2">📊 Scores</p>
                <div className="space-y-1 text-sm">
                  <ScoreRow label={`Current (Round ${report.round})`} score={caseResult.score} primary />
                  {previousCase && report.round > 1 && (
                    <ScoreRow label="Previous round" score={previousCase.score} />
                  )}
                  {baselineCase && report.round > 0 && (
                    <ScoreRow label="Baseline (Round 0)" score={baselineCase.score} />
                  )}
                </div>

                {/* Per-metric breakdown */}
                {Object.keys(caseResult.sub_scores).length > 0 && (
                  <div className="mt-3 pt-3 border-t border-border space-y-1">
                    {RAGAS_METRIC_DISPLAY.map((m) => {
                      const s = caseResult.sub_scores[m.key];
                      if (typeof s !== 'number') return null;
                      const passed = caseResult.sub_passed?.[m.key] ?? false;
                      return (
                        <div key={m.key} className="flex items-center text-xs">
                          <span className="w-44 text-text-secondary">
                            {m.emoji} {m.label}
                          </span>
                          <ScoreChip score={s} className="mr-3" />
                          <span className={passed ? 'text-success' : 'text-destructive'}>
                            {passed ? '✅ PASS' : '❌ FAIL'}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Actual */}
              <Section emoji="💬" title="Actual answer">
                {caseResult.actual || <em className="text-text-tertiary">(empty)</em>}
              </Section>

              {/* Judge reasoning */}
              {caseResult.judge_reasoning && (
                <details>
                  <summary className="cursor-pointer text-xs text-text-tertiary">
                    🧪 Judge reasoning
                  </summary>
                  <pre className="text-xs whitespace-pre-wrap text-text-secondary mt-2 bg-surface-subtle border border-border rounded p-2">
                    {caseResult.judge_reasoning.slice(0, 2000)}
                  </pre>
                </details>
              )}

              {/* What needs to reach 100% — the gap analysis block */}
              {caseResult.score < 1.0 && caseResult.gap_analysis && (
                <GapAnalysisBlock gap={caseResult.gap_analysis} currentScore={caseResult.score} />
              )}

              {caseResult.response_time_seconds > 0 && (
                <p className="text-xs text-text-tertiary font-mono">
                  ⏱ SUT response: {caseResult.response_time_seconds.toFixed(1)}s
                </p>
              )}
            </CardContent>
          </Card>
        );
      })}

      {/* ── Summary ── */}
      <SummaryTile results={report.results} />
    </ReportShell>
  );
}

// ──────────────────────────────────────────────────────────────────

function ReportShell({
  id,
  round,
  runId,
  reportRound,
  children,
}: {
  id: string;
  round: string;
  runId?: string;
  reportRound?: number;
  children: React.ReactNode;
}) {
  return (
    <main className="min-h-screen bg-surface-page">
      <header className="border-b border-border bg-background/60 backdrop-blur sticky top-0 z-10">
        <div className="mx-auto max-w-5xl px-6 h-14 flex items-center justify-between">
          <Link
            href={`/runs/${id}`}
            className="flex items-center gap-2 text-sm text-text-secondary hover:text-foreground"
          >
            <ArrowLeft className="h-4 w-4" /> Run
          </Link>
          <h1 className="font-medium tracking-tight">
            Report · <span className="font-mono text-xs text-text-tertiary">round {round}</span>
          </h1>
          {runId && reportRound !== undefined ? (
            <a href={`/api/runs/${runId}/reports/${reportRound}.txt`}>
              <Button variant="outline" size="sm">
                <Download className="h-3.5 w-3.5" /> .txt
              </Button>
            </a>
          ) : (
            <div className="w-12" />
          )}
        </div>
      </header>
      <div className="mx-auto max-w-5xl px-6 py-8 space-y-6">{children}</div>
    </main>
  );
}

function Section({
  emoji,
  title,
  children,
}: {
  emoji: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <p className="text-[11px] font-mono uppercase tracking-wider text-text-tertiary mb-1">
        {emoji} {title}
      </p>
      <div className="text-sm text-text-secondary leading-relaxed whitespace-pre-wrap">{children}</div>
    </div>
  );
}

function ScoreRow({
  label,
  score,
  primary = false,
}: {
  label: string;
  score: number;
  primary?: boolean;
}) {
  return (
    <div className="flex items-center justify-between">
      <span className={primary ? 'font-medium' : 'text-text-tertiary'}>{label}</span>
      <span style={{ color: scoreToken(score) }} className="font-mono">
        {pct(score, 1)}
      </span>
    </div>
  );
}

function GapAnalysisBlock({
  gap,
  currentScore,
}: {
  gap: NonNullable<RoundReport['results']['cases'][number]['gap_analysis']>;
  currentScore: number;
}) {
  const sections: { emoji: string; label: string; items: string[] }[] = [
    { emoji: '❌', label: 'MISSING TRIPLES', items: gap.missing_triples },
    { emoji: '❌', label: 'MISSING KNOWLEDGE', items: gap.missing_knowledge },
    { emoji: '📊', label: 'MISSING DATA POINTS', items: gap.missing_data_points },
    { emoji: '📝', label: 'MISSING KEY TERMS', items: gap.missing_key_terms },
  ];
  const target = 1.0;
  const gapPp = ((target - currentScore) * 100).toFixed(0);

  return (
    <div className="border-2 border-warning/30 bg-warning/5 rounded-md p-4 space-y-3">
      <div className="flex items-center justify-between">
        <p className="font-medium text-warning flex items-center gap-2">
          💡 What needs to reach 100%
        </p>
        <span className="font-mono text-xs text-text-tertiary">
          ✨ {pct(currentScore)} → 100% (need +{gapPp}%)
        </span>
      </div>
      {sections.map((s) => (
        <div key={s.label}>
          <p className="text-[11px] font-mono uppercase tracking-wider text-text-tertiary mb-1">
            {s.emoji} {s.label} ({s.items.length})
          </p>
          {s.items.length === 0 ? (
            <p className="text-xs text-text-tertiary italic ml-4">(none missing!)</p>
          ) : (
            <ul className="text-xs text-text-secondary space-y-0.5 ml-4">
              {s.items.slice(0, 8).map((it, i) => (
                <li key={i}>• {it}</li>
              ))}
            </ul>
          )}
        </div>
      ))}
      {gap.score_gap_reason && (
        <div className="border-t border-warning/20 pt-3">
          <p className="text-xs">
            <span className="text-text-tertiary">📝 SCORE GAP:</span>{' '}
            <span className="text-text-secondary">{gap.score_gap_reason}</span>
          </p>
          <p className="text-xs mt-1">
            <span className="text-text-tertiary">📈 PROJECTED IF ADDRESSED:</span>{' '}
            <span className="text-success font-mono">{pct(gap.projected_score)}</span>
          </p>
        </div>
      )}
    </div>
  );
}

function SummaryTile({ results }: { results: ScoreBatchResponse }) {
  // Per-metric averages — same convention as desci-dkg dashboard.
  const metricAverages: Record<string, { sum: number; count: number }> = {};
  for (const c of results.cases) {
    for (const [k, v] of Object.entries(c.sub_scores)) {
      if (typeof v !== 'number') continue;
      if (!metricAverages[k]) metricAverages[k] = { sum: 0, count: 0 };
      metricAverages[k].sum += v;
      metricAverages[k].count += 1;
    }
  }
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Summary — average per metric</CardTitle>
        <CardDescription>
          Composite (Correctness Score): {pct(results.overall_score, 1)} ·{' '}
          {results.cases.filter((c) => c.passed).length}/{results.cases.length} cases passed
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-1">
        {RAGAS_METRIC_DISPLAY.map((m) => {
          const t = metricAverages[m.key];
          if (!t || t.count === 0) return null;
          const avg = t.sum / t.count;
          return (
            <div key={m.key} className="flex items-center text-sm">
              <span className="w-48 text-text-secondary">
                {m.emoji} {m.label}
              </span>
              <ScoreChip score={avg} className="mr-3" />
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
