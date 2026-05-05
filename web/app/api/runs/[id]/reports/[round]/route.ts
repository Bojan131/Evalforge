/**
 * GET  /api/runs/:id/reports/:round       — JSON report for one round
 * GET  /api/runs/:id/reports/:round.txt   — plain-text export (desci-dkg style)
 *
 * The text export is generated on-demand from the structured RoundReport
 * stored in RunState.reports. Single source of truth — UI and txt never
 * diverge.
 */

import { NextResponse } from 'next/server';
import { runStore } from '@/lib/run-store';
import { renderTextReport } from '@/lib/report';

export async function GET(
  req: Request,
  ctx: { params: Promise<{ id: string; round: string }> }
) {
  const { id, round: roundRaw } = await ctx.params;

  // Strip an optional .txt suffix and decide format
  const isTxt = roundRaw.endsWith('.txt');
  const roundNum = parseInt(roundRaw.replace(/\.txt$/, ''), 10);
  if (Number.isNaN(roundNum)) {
    return NextResponse.json({ error: 'Invalid round number' }, { status: 400 });
  }

  const run = runStore.get(id);
  if (!run) return NextResponse.json({ error: 'Run not found' }, { status: 404 });

  const report = run.reports.find((r) => r.round === roundNum);
  if (!report) return NextResponse.json({ error: 'Report not found' }, { status: 404 });

  const baseline = run.reports.find((r) => r.round === 0);
  const previous = run.reports.find((r) => r.round === roundNum - 1);

  if (!isTxt) {
    return NextResponse.json({
      report,
      baseline,
      previous,
      run_id: run.run_id,
    });
  }

  const txt = renderTextReport({
    round: roundNum,
    label: report.label,
    cases: run.input_cases,
    current: report.results,
    baseline: baseline?.results,
    previous: previous?.results,
    generatedAt: report.generated_at,
    judgeModel: report.results.judge_model,
  });

  return new Response(txt, {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Content-Disposition': `attachment; filename="evalforge-${run.run_id}-round-${roundNum}.txt"`,
    },
  });
}
