/**
 * Report generator — produces desci-dkg-style evaluation reports per round.
 *
 * Two output formats:
 *   1. Plain text — pixel-for-pixel match with the txt export desci-dkg
 *      ships (same separators, emojis, section ordering, "WHAT NEEDS TO
 *      REACH 100%" diagnostic block). Used for download / API export.
 *   2. Structured object — same data, no formatting. The UI renders it
 *      with Card components but the layout follows the txt one exactly
 *      so the customer sees the same artifact whether they download or
 *      view in-app.
 *
 * Design philosophy: the txt export IS the report. The UI is a richer
 * version of the same thing. They never diverge.
 */

import type { RoundReport, CaseResult, EvalCase, ScoreBatchResponse } from './types/eval';
import { RAGAS_METRIC_DISPLAY } from './types/eval';

const SEP_LARGE = '='.repeat(80);
const SEP_DASH = '─'.repeat(80);
const SEP_RAREK = '═'.repeat(75);

/** Format 0..1 score as "73%". Match the desci-dkg style. */
function pctRaw(score: number, decimals = 0): string {
  return `${(score * 100).toFixed(decimals)}%`;
}

function statusEmoji(passed: boolean): string {
  return passed ? '✅' : '❌';
}

function scoreEmoji(score: number): string {
  if (score >= 0.8) return '🟢';
  if (score >= 0.6) return '🟡';
  return '🔴';
}

// ─────────────────────────────────────────────────────────────────────────────
// Plain-text report (pixel-match with desci-dkg)
// ─────────────────────────────────────────────────────────────────────────────

interface RenderInput {
  /** Round being reported on. Round 0 = baseline; 1+ = patches applied. */
  round: number;
  label: string;
  /** Case definitions (question + expected). Indexed by id. */
  cases: EvalCase[];
  /** Per-case results from this round. */
  current: ScoreBatchResponse;
  /** Optional baseline (round 0) to compare against — populates the
   *  "compared to baseline" rows. */
  baseline?: ScoreBatchResponse;
  /** Optional previous round (round-1) for round-over-round delta. */
  previous?: ScoreBatchResponse;
  generatedAt: string;
  judgeModel: string;
}

/**
 * Generate the full text report. Long but deliberate — every section
 * mirrors desci-dkg conventions so the report reads as familiar.
 */
export function renderTextReport(input: RenderInput): string {
  const { round, label, cases, current, baseline, previous, generatedAt, judgeModel } = input;

  const caseLookup = new Map(cases.map((c) => [c.id, c]));
  const baselineLookup = baseline ? new Map(baseline.cases.map((c) => [c.case_id, c])) : null;
  const previousLookup = previous ? new Map(previous.cases.map((c) => [c.case_id, c])) : null;

  const lines: string[] = [];

  // ── Header ──
  lines.push(SEP_LARGE);
  lines.push(`📚 EVALFORGE EVALUATION REPORT — ${label}`);
  lines.push(SEP_LARGE);
  lines.push(`This report shows per-question scores for round ${round}.`);
  if (baseline && round > 0) {
    lines.push(`Compared against round 0 (baseline) so you can see lift per case.`);
  }
  lines.push(SEP_LARGE);
  lines.push('');
  lines.push(`📅 Generated:    ${generatedAt}`);
  lines.push(`⚖️  Judge model:  ${judgeModel}`);
  lines.push(`📊 Overall score: ${scoreEmoji(current.overall_score)} ${pctRaw(current.overall_score, 1)}`);
  lines.push(
    `🎯 Pass rate:     ${pctRaw(current.pass_rate, 1)} (${current.cases.filter((c) => c.passed).length}/${current.cases.length} cases passed)`
  );
  if (baseline) {
    const lift = current.overall_score - baseline.overall_score;
    const sign = lift >= 0 ? '+' : '';
    lines.push(`📈 Lift vs baseline: ${sign}${(lift * 100).toFixed(1)}pp`);
  }
  lines.push('');

  // ── Per-question detail ──
  current.cases.forEach((caseResult, idx) => {
    const original = caseLookup.get(caseResult.case_id);
    if (!original) return;
    lines.push('');
    lines.push(SEP_LARGE);
    lines.push(`QUESTION #${idx + 1}`);
    lines.push(SEP_LARGE);
    lines.push('❓ Question:');
    lines.push(original.question);
    lines.push('');
    lines.push('✅ Expected Answer:');
    lines.push(original.expected);
    if (original.context) {
      lines.push('');
      lines.push('📚 Context:');
      lines.push(original.context.slice(0, 400) + (original.context.length > 400 ? '…' : ''));
    }
    lines.push('');
    lines.push('📊 SCORES:');
    const baselineCase = baselineLookup?.get(caseResult.case_id);
    const previousCase = previousLookup?.get(caseResult.case_id);
    lines.push(`- Current (Round ${round}):  Answer Correctness: ${pctRaw(caseResult.score)}`);
    if (previousCase && round > 1) {
      lines.push(`- Previous Round:           Answer Correctness: ${pctRaw(previousCase.score)}`);
    }
    if (baselineCase && round > 0) {
      lines.push(`- Baseline (Round 0):       Answer Correctness: ${pctRaw(baselineCase.score)}`);
    }

    // Per-metric breakdown
    if (Object.keys(caseResult.sub_scores).length > 0) {
      lines.push('');
      lines.push('   Per-metric:');
      for (const m of RAGAS_METRIC_DISPLAY) {
        const s = caseResult.sub_scores[m.key];
        if (typeof s !== 'number') continue;
        const passed = caseResult.sub_passed?.[m.key] ?? false;
        lines.push(`     ${m.emoji} ${m.label.padEnd(20)} ${scoreEmoji(s)} ${pctRaw(s)}   ${statusEmoji(passed)} ${passed ? 'PASS' : 'FAIL'}`);
      }
    }

    lines.push('');
    lines.push('💬 Actual Answer:');
    lines.push(caseResult.actual || '(empty)');
    if (caseResult.judge_reasoning) {
      lines.push('');
      lines.push('🧪 Judge reasoning:');
      lines.push(caseResult.judge_reasoning.slice(0, 600));
    }
    if (typeof caseResult.response_time_seconds === 'number' && caseResult.response_time_seconds > 0) {
      lines.push('');
      lines.push(`⏱️  SUT Response Time: ${caseResult.response_time_seconds.toFixed(1)}s`);
    }

    // ── "What needs to reach 100%" diagnostic block ──
    if (caseResult.score < 1.0 && caseResult.gap_analysis) {
      const gap = caseResult.gap_analysis;
      const target = 1.0;
      const gapPp = (target - caseResult.score) * 100;
      lines.push('');
      lines.push(SEP_LARGE);
      lines.push("💡 WHAT NEEDS TO REACH 100%");
      lines.push(SEP_LARGE);
      lines.push(`   ✨ Current Score: ${pctRaw(caseResult.score)} → Target: 100% (need +${gapPp.toFixed(0)}%)`);
      lines.push('');
      lines.push(`   ❌ MISSING TRIPLES: (${gap.missing_triples.length} item${gap.missing_triples.length === 1 ? '' : 's'})`);
      if (gap.missing_triples.length === 0) {
        lines.push('      (None missing!)');
      } else {
        for (const t of gap.missing_triples.slice(0, 8)) lines.push(`      • ${t}`);
      }
      lines.push('');
      lines.push(`   ❌ MISSING KNOWLEDGE: (${gap.missing_knowledge.length} item${gap.missing_knowledge.length === 1 ? '' : 's'})`);
      if (gap.missing_knowledge.length === 0) {
        lines.push('      (None missing!)');
      } else {
        for (const k of gap.missing_knowledge.slice(0, 8)) lines.push(`      • ${k}`);
      }
      lines.push('');
      lines.push(`   📊 MISSING DATA POINTS: (${gap.missing_data_points.length} item${gap.missing_data_points.length === 1 ? '' : 's'})`);
      if (gap.missing_data_points.length === 0) {
        lines.push('      (None missing!)');
      } else {
        for (const d of gap.missing_data_points.slice(0, 8)) lines.push(`      • ${d}`);
      }
      lines.push('');
      lines.push(`   📝 MISSING KEY TERMS: (${gap.missing_key_terms.length} item${gap.missing_key_terms.length === 1 ? '' : 's'})`);
      if (gap.missing_key_terms.length === 0) {
        lines.push('      (None missing!)');
      } else {
        for (const k of gap.missing_key_terms.slice(0, 12)) lines.push(`      • ${k}`);
      }
      lines.push('');
      lines.push(`   ${SEP_RAREK}`);
      lines.push(`   📝 SCORE GAP: ${gap.score_gap_reason || '(unspecified)'}`);
      lines.push(
        `   📈 PROJECTED SCORE IF ADDRESSED: ${pctRaw(caseResult.score)} + ${(((gap.projected_score - caseResult.score) * 100)).toFixed(0)}% = ${pctRaw(gap.projected_score)}`
      );
      lines.push(`   ${SEP_RAREK}`);
    }
    lines.push('');
    lines.push(SEP_LARGE);
  });

  // ── Summary section (per-metric averages, like desci-dkg dashboard) ──
  lines.push('');
  lines.push(SEP_LARGE);
  lines.push('📊 SUMMARY — AVERAGE SCORES PER METRIC');
  lines.push(SEP_LARGE);
  lines.push('');
  const metricAverages = computeMetricAverages(current.cases);
  for (const m of RAGAS_METRIC_DISPLAY) {
    const avg = metricAverages[m.key];
    if (typeof avg !== 'number') continue;
    lines.push(`${m.emoji} ${m.label.padEnd(20)} ${scoreEmoji(avg)} ${pctRaw(avg, 1)}`);
  }
  lines.push('');
  const passingCases = current.cases.filter((c) => c.passed).length;
  lines.push(`Composite (Correctness Score): ${pctRaw(current.overall_score, 1)}`);
  lines.push(`Cases Passed: ${passingCases}/${current.cases.length}`);
  lines.push(`Individual Scores: ${current.cases.map((c) => pctRaw(c.score)).join(', ')}`);
  lines.push('');
  lines.push(SEP_LARGE);
  lines.push("NOTE: 'Correctness Score' is the weighted mean of all active RAGAS metrics.");
  lines.push("      A case 'passes' when its composite score >= rubric.pass_threshold.");
  lines.push(SEP_LARGE);

  return lines.join('\n');
}

/**
 * Compute per-metric average across an array of CaseResults.
 * Same convention desci-dkg uses in its summary section.
 */
export function computeMetricAverages(cases: CaseResult[]): Record<string, number> {
  const totals: Record<string, { sum: number; count: number }> = {};
  for (const c of cases) {
    for (const [k, v] of Object.entries(c.sub_scores)) {
      if (typeof v !== 'number') continue;
      if (!totals[k]) totals[k] = { sum: 0, count: 0 };
      totals[k].sum += v;
      totals[k].count += 1;
    }
  }
  const out: Record<string, number> = {};
  for (const [k, t] of Object.entries(totals)) {
    out[k] = t.count > 0 ? t.sum / t.count : 0;
  }
  return out;
}

/**
 * Build the structured RoundReport object stored in RunState.reports.
 * The UI reads this; the text export is generated on demand from it.
 */
export function buildRoundReport(args: {
  round: number;
  label: string;
  results: ScoreBatchResponse;
  clusters?: RoundReport['clusters'];
  patchApplied?: RoundReport['patch_applied'];
}): RoundReport {
  return {
    round: args.round,
    label: args.label,
    results: args.results,
    clusters: args.clusters ?? [],
    patch_applied: args.patchApplied ?? null,
    generated_at: new Date().toISOString(),
  };
}
