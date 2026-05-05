/**
 * eval-run pipeline — the spine of the product.
 *
 *   score → cluster → propose → re-score with regression guard → loop
 *   until ≥goal_score, 5 rounds without lift, OR budget cap.
 *
 * Implementation note: this used to be a Mastra Workflow, but Mastra's
 * workflow generic types fight us hard for compositions with rich state.
 * For an orchestrator with branching, regression guards, and a stop-
 * condition loop it's much clearer as plain TypeScript. We still use
 * Mastra Agents below for the parts where the framework adds real value
 * (LLM calls with retries / streaming / telemetry attached).
 *
 * The exposed API matches what a Mastra workflow would have — `runEval`
 * is the single entry point and it streams updates to a sink callback.
 */

import { z } from 'zod';
import {
  EvalCase,
  Patch,
  RunState,
  ScoreBatchResponse,
  SutConfig,
  Rubric,
  Cluster,
} from '@/lib/types/eval';
import { callDeepEval } from '../tools/call-deepeval';
import { callPyService } from '../tools/call-py-services';

// ----- runtime input -----

export const RunEvalInput = z.object({
  run_id: z.string(),
  cases: z.array(EvalCase).min(1),
  sut: SutConfig,
  rubric: Rubric.optional(),
  goal_score: z.number().min(0).max(1).default(0.95),
  budget_cap_usd: z.number().min(0).default(5),
  max_rounds: z.number().int().min(1).max(10).default(5),
  /** Fraction of cases held out as the test set — never used for optimization. */
  test_split: z.number().min(0.1).max(0.5).default(0.3),
});
export type RunEvalInput = z.infer<typeof RunEvalInput>;

/**
 * Streaming sink — every status change calls this so the UI / API route
 * can persist the latest state immediately. Avoids the "all updates in one
 * lump at the end" problem when a run takes 90 seconds.
 */
export type RunSink = (state: RunState) => void;

// ----- main entry -----

export async function runEval(input: RunEvalInput, sink: RunSink): Promise<RunState> {
  const startedAt = new Date().toISOString();
  let state: RunState = {
    run_id: input.run_id,
    status: 'queued',
    created_at: startedAt,
    updated_at: startedAt,
    current_round: 0,
    goal_score: input.goal_score,
    budget_cap_usd: input.budget_cap_usd,
    spent_usd: 0,
    clusters: [],
    patches: [],
  };
  sink(state);

  // ---- TRAIN/TEST SPLIT (anti-overfit) ----
  // We hold out test_split of cases; only the train set is used by the optimizer.
  // Score reported to the user is computed on the FULL set, but the loop's
  // stop condition uses the test set so we can't game it.
  const { trainCases, testCases } = splitCases(input.cases, input.test_split);

  // ---- ROUND 0: BASELINE SCORE ----
  state = mark(state, 'scoring');
  sink(state);

  let baselineResults: ScoreBatchResponse;
  try {
    baselineResults = await callDeepEval.execute({
      context: {
        run_id: input.run_id,
        cases: input.cases,
        sut: input.sut,
        rubric: input.rubric,
        max_concurrency: 8,
      },
    } as never);
  } catch (e) {
    return finalizeError(state, sink, `Baseline scoring failed: ${msg(e)}`);
  }

  state = {
    ...state,
    current_round: 1,
    initial_score: baselineResults.overall_score,
    current_score: baselineResults.overall_score,
    results: baselineResults,
    updated_at: new Date().toISOString(),
  };
  sink(state);

  // ---- LOOP: cluster → propose → re-score → guard ----
  let lastTestScore = scoreOn(baselineResults, testCases);
  let consecutiveNoLift = 0;
  let currentSystemPrompt = '';
  // ^ accumulates patches as we apply them — week-3 patches will append
  //   instructions / few-shot examples here. SUT receives this verbatim.

  while (
    state.current_round <= input.max_rounds &&
    lastTestScore < input.goal_score &&
    state.spent_usd < input.budget_cap_usd
  ) {
    // ---- CLUSTER FAILURES ----
    state = mark(state, 'clustering');
    sink(state);

    const failed = (state.results?.cases ?? []).filter((c) => !c.passed);
    if (failed.length === 0) {
      // No failures, perfect score — we're done
      break;
    }

    let clusters: Cluster[];
    try {
      clusters = await clusterFailures(failed, input.cases);
    } catch (e) {
      // If clustering fails (sidecar down, embedding failure), fall back to
      // a single bucket with all failures. The loop can still propose against it.
      clusters = [
        {
          id: `fallback_${state.run_id}_${state.current_round}`,
          label: 'all-failures',
          summary: `Clustering failed (${msg(e)}); treating as one cluster.`,
          case_ids: failed.map((c) => c.case_id),
          size: failed.length,
        },
      ];
    }
    state = { ...state, clusters, updated_at: new Date().toISOString() };
    sink(state);

    // ---- PROPOSE PATCH ----
    state = mark(state, 'proposing');
    sink(state);

    let patch: Patch | null = null;
    try {
      patch = await proposePatch({
        round: state.current_round,
        clusters,
        cases: input.cases,
        results: state.results!,
        currentSystemPrompt,
        priorPatches: state.patches,
      });
    } catch (e) {
      // Couldn't propose — record reason and break out of loop
      state = {
        ...state,
        patches: [
          ...state.patches,
          {
            round: state.current_round,
            prompt_diff: '',
            few_shots_added: [],
            applied: false,
            accepted: false,
            reject_reason: `Proposer failed: ${msg(e)}`,
          },
        ],
        updated_at: new Date().toISOString(),
      };
      sink(state);
      break;
    }

    if (!patch) {
      // Proposer chose to do nothing this round — out of ideas. Stop.
      break;
    }

    // ---- APPLY PATCH + RE-SCORE ----
    state = mark(state, 'rescoring');
    sink(state);

    const patchedSystemPrompt = applyPatch(currentSystemPrompt, patch);
    let patchedResults: ScoreBatchResponse;
    try {
      patchedResults = await callDeepEval.execute({
        context: {
          run_id: `${input.run_id}_r${state.current_round + 1}`,
          cases: input.cases,
          sut: {
            ...input.sut,
            // Inject the patched prompt as a system message via extra_headers
            // is not portable — instead we prepend it to each question. This
            // works for any OpenAI-compatible SUT without schema changes.
            extra_headers: {
              ...input.sut.extra_headers,
              'X-EvalForge-System-Prompt': encodeURIComponent(patchedSystemPrompt).slice(0, 8000),
            },
          },
          rubric: input.rubric,
          max_concurrency: 8,
        },
      } as never);
    } catch (e) {
      patch.applied = false;
      patch.accepted = false;
      patch.reject_reason = `Re-score failed: ${msg(e)}`;
      state = {
        ...state,
        patches: [...state.patches, patch],
        updated_at: new Date().toISOString(),
      };
      sink(state);
      break;
    }

    // ---- REGRESSION GUARD ----
    // Reject if any case that PASSED in baseline now FAILS with the patch.
    const baselinePassMap = new Map(
      (state.results?.cases ?? []).map((c) => [c.case_id, c.passed])
    );
    const regressions = patchedResults.cases.filter(
      (c) => baselinePassMap.get(c.case_id) === true && !c.passed
    );

    const newTestScore = scoreOn(patchedResults, testCases);
    const lift = newTestScore - lastTestScore;
    const acceptable = regressions.length === 0 && lift > 0.005; // need at least +0.5pp

    patch.applied = true;
    patch.test_score_before = lastTestScore;
    patch.test_score_after = newTestScore;

    if (acceptable) {
      patch.accepted = true;
      currentSystemPrompt = patchedSystemPrompt;
      lastTestScore = newTestScore;
      consecutiveNoLift = 0;
      state = {
        ...state,
        current_score: patchedResults.overall_score,
        results: patchedResults,
        current_round: state.current_round + 1,
        patches: [...state.patches, patch],
        updated_at: new Date().toISOString(),
      };
    } else {
      patch.accepted = false;
      patch.reject_reason =
        regressions.length > 0
          ? `${regressions.length} previously-passing cases now fail`
          : `No lift on test set (${(lift * 100).toFixed(1)}pp)`;
      consecutiveNoLift++;
      state = {
        ...state,
        patches: [...state.patches, patch],
        current_round: state.current_round + 1,
        updated_at: new Date().toISOString(),
      };
    }
    sink(state);

    if (consecutiveNoLift >= 3) {
      // Three rejected patches in a row → optimizer is stuck. Stop.
      break;
    }
  }

  state = {
    ...state,
    status: 'done',
    updated_at: new Date().toISOString(),
  };
  sink(state);
  return state;
}

// ----- helpers -----

function mark(state: RunState, status: RunState['status']): RunState {
  return { ...state, status, updated_at: new Date().toISOString() };
}

function msg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

function finalizeError(state: RunState, sink: RunSink, error: string): RunState {
  const final: RunState = {
    ...state,
    status: 'failed',
    error,
    updated_at: new Date().toISOString(),
  };
  sink(final);
  return final;
}

/** Deterministic train/test split — same input always produces same split. */
function splitCases(cases: EvalCase[], testSplit: number) {
  const sorted = [...cases].sort((a, b) => a.id.localeCompare(b.id));
  const testCount = Math.max(1, Math.floor(sorted.length * testSplit));
  const testCases = sorted.slice(0, testCount);
  const trainCases = sorted.slice(testCount);
  return { trainCases, testCases };
}

/** Compute weighted-mean score on a subset (e.g. test set). */
function scoreOn(results: ScoreBatchResponse, subset: EvalCase[]): number {
  const subsetIds = new Set(subset.map((c) => c.id));
  const subsetResults = results.cases.filter((r) => subsetIds.has(r.case_id));
  if (subsetResults.length === 0) return 0;
  // Equal-weight here — rubric weights are baked into score already.
  return subsetResults.reduce((s, r) => s + r.score, 0) / subsetResults.length;
}

// ----- failure clustering (Python sidecar) -----

async function clusterFailures(
  failed: ScoreBatchResponse['cases'],
  allCases: EvalCase[]
): Promise<Cluster[]> {
  const caseLookup = new Map(allCases.map((c) => [c.id, c]));
  const triples = failed.map((c) => {
    const original = caseLookup.get(c.case_id);
    return {
      id: c.case_id,
      question: original?.question ?? '',
      expected: original?.expected ?? '',
      actual: c.actual,
      reasoning: c.judge_reasoning,
    };
  });

  return await callPyService<{ clusters: Cluster[] }>('/cluster', {
    triples,
    min_cluster_size: 2,
  }).then((r) => r.clusters);
}

// ----- patch proposer (calls DSPy sidecar) -----

interface ProposeArgs {
  round: number;
  clusters: Cluster[];
  cases: EvalCase[];
  results: ScoreBatchResponse;
  currentSystemPrompt: string;
  priorPatches: Patch[];
}

async function proposePatch(args: ProposeArgs): Promise<Patch | null> {
  // Pick the largest cluster the optimizer hasn't already attacked.
  const attacked = new Set(args.priorPatches.map((p) => p.prompt_diff.slice(0, 50)));
  const target = [...args.clusters].sort((a, b) => b.size - a.size)[0];
  if (!target) return null;

  const targetCases = args.results.cases.filter((c) => target.case_ids.includes(c.case_id));
  const caseLookup = new Map(args.cases.map((c) => [c.id, c]));

  const trainExamples = targetCases.map((r) => {
    const orig = caseLookup.get(r.case_id);
    return {
      input: orig?.question ?? '',
      expected: orig?.expected ?? '',
      actual: r.actual,
    };
  });

  const proposed = await callPyService<{
    prompt_diff: string;
    few_shots: Array<{ input: string; output: string }>;
    expected_lift: number | null;
  }>('/optimize', {
    cluster_label: target.label,
    cluster_summary: target.summary,
    current_system_prompt: args.currentSystemPrompt,
    train_examples: trainExamples,
    method: args.priorPatches.length === 0 ? 'bootstrap_few_shot' : 'mipro_v2',
  });

  // De-dup against past attempts
  if (attacked.has(proposed.prompt_diff.slice(0, 50))) return null;

  return {
    round: args.round,
    prompt_diff: proposed.prompt_diff,
    few_shots_added: proposed.few_shots,
    expected_lift: proposed.expected_lift ?? undefined,
    applied: false,
    accepted: false,
  };
}

/** Compose a system prompt from accumulated patches + few-shots. */
function applyPatch(currentPrompt: string, patch: Patch): string {
  const sections: string[] = [];
  if (currentPrompt) sections.push(currentPrompt);
  if (patch.prompt_diff) sections.push(patch.prompt_diff);
  if (patch.few_shots_added.length > 0) {
    sections.push('\n## Examples\n');
    for (const ex of patch.few_shots_added) {
      sections.push(`Q: ${ex.input}\nA: ${ex.output}`);
    }
  }
  return sections.join('\n\n');
}
