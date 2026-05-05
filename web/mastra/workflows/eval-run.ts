/**
 * eval-run workflow — the spine of the product.
 *
 *   score → cluster → propose → re-score → loop until stop condition
 *
 * Week 1 (this file): step 1 (score) is fully wired. Steps 2-5 are typed
 * stubs that pass through state so the API + UI layers can be built and
 * exercised end-to-end. Implementations slot in over weeks 2-4 without
 * changing this file's shape.
 *
 * Stop conditions:
 *   - test-set score ≥ goal_score (default 0.95)
 *   - 5 rounds without lift on dev set
 *   - spent_usd ≥ budget_cap_usd
 *
 * Mastra primitives we lean on:
 *   - createWorkflow() with named steps
 *   - per-step input/output zod schemas (type safety end-to-end)
 *   - .commit() to freeze the graph and produce an executable
 */

import { createWorkflow, createStep } from '@mastra/core/workflows';
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

// ----- workflow input -----

const InitInput = z.object({
  run_id: z.string(),
  cases: z.array(EvalCase).min(1),
  sut: SutConfig,
  rubric: Rubric.optional(),
  goal_score: z.number().min(0).max(1).default(0.95),
  budget_cap_usd: z.number().min(0).default(5),
});

// ----- step 1: score -----

const scoreStep = createStep({
  id: 'score',
  description: 'Score the eval set against the customer SUT.',
  inputSchema: InitInput,
  outputSchema: z.object({
    state: RunState,
    results: ScoreBatchResponse,
  }),
  execute: async ({ inputData }) => {
    const startedAt = new Date().toISOString();
    const results = await callDeepEval.execute({
      context: {
        run_id: inputData.run_id,
        cases: inputData.cases,
        sut: inputData.sut,
        rubric: inputData.rubric,
        max_concurrency: 8,
      },
      // Mastra's tool exec signature includes the tool runtime; we don't use it.
    } as never);

    const state: RunState = {
      run_id: inputData.run_id,
      status: 'scoring',
      created_at: startedAt,
      updated_at: new Date().toISOString(),
      current_round: 1,
      initial_score: results.overall_score,
      current_score: results.overall_score,
      goal_score: inputData.goal_score,
      budget_cap_usd: inputData.budget_cap_usd,
      spent_usd: 0,
      results,
      clusters: [],
      patches: [],
    };
    return { state, results };
  },
});

// ----- step 2: cluster (week 2 stub) -----

const clusterStep = createStep({
  id: 'cluster',
  description:
    'Embed failed cases, HDBSCAN cluster, LLM-summarize. STUB — week 2.',
  inputSchema: z.object({ state: RunState, results: ScoreBatchResponse }),
  outputSchema: z.object({ state: RunState }),
  execute: async ({ inputData }) => {
    const { state, results } = inputData;

    // Week 2 will replace this with real clustering. For week 1 we synthesise
    // a single "all failures" pseudo-cluster so downstream stubs have data.
    const failed = results.cases.filter((c) => !c.passed);
    const stubCluster: Cluster | null =
      failed.length > 0
        ? {
            id: `cluster_stub_${state.run_id}`,
            label: 'unclustered',
            summary:
              'Week 2 stub — real clustering with embeddings + HDBSCAN ships next.',
            case_ids: failed.map((c) => c.case_id),
            size: failed.length,
          }
        : null;

    return {
      state: {
        ...state,
        status: 'clustering',
        updated_at: new Date().toISOString(),
        clusters: stubCluster ? [stubCluster] : [],
      },
    };
  },
});

// ----- step 3: propose patch (week 3 stub) -----

const proposeStep = createStep({
  id: 'propose',
  description: 'Call DSPy to synthesise a targeted patch. STUB — week 3.',
  inputSchema: z.object({ state: RunState }),
  outputSchema: z.object({ state: RunState, patch: Patch.nullable() }),
  execute: async ({ inputData }) => {
    const { state } = inputData;
    // Week 3: invoke patchProposerAgent which calls the DSPy sidecar.
    // Week 1: no patch — we just observe the score.
    return {
      state: {
        ...state,
        status: 'proposing',
        updated_at: new Date().toISOString(),
      },
      patch: null,
    };
  },
});

// ----- step 4: re-score with patch (week 3 stub) -----

const rescoreStep = createStep({
  id: 'rescore',
  description:
    'Apply the patch and re-score. Reject + roll back if regressions on previously-passing cases. STUB — week 3.',
  inputSchema: z.object({ state: RunState, patch: Patch.nullable() }),
  outputSchema: z.object({ state: RunState }),
  execute: async ({ inputData }) => {
    const { state, patch } = inputData;
    // Week 3 implementation:
    //   if (!patch) → mark done
    //   else → call_deepeval with the patched system prompt, compare to baseline,
    //          regression-guard, accept or reject + reason
    return {
      state: {
        ...state,
        status: patch ? 'rescoring' : 'done',
        updated_at: new Date().toISOString(),
      },
    };
  },
});

// ----- step 5: stop check (week 4 stub) -----

const stopCheckStep = createStep({
  id: 'stop-check',
  description:
    'Decide whether to loop another round, stop on success, or stop on budget/no-lift. STUB — week 4.',
  inputSchema: z.object({ state: RunState }),
  outputSchema: z.object({ state: RunState, shouldContinue: z.boolean() }),
  execute: async ({ inputData }) => {
    const { state } = inputData;
    const reachedGoal = (state.current_score ?? 0) >= state.goal_score;
    const overBudget = state.spent_usd >= state.budget_cap_usd;
    const tooManyRounds = state.current_round >= 5;
    const shouldContinue = !(reachedGoal || overBudget || tooManyRounds);
    return {
      state: {
        ...state,
        status: shouldContinue ? state.status : 'done',
        updated_at: new Date().toISOString(),
      },
      shouldContinue,
    };
  },
});

// ----- workflow assembly -----

export const evalRunWorkflow = createWorkflow({
  id: 'eval-run',
  description:
    'Score → cluster → propose → re-score → loop until ≥95% / 5 rounds / budget cap.',
  inputSchema: InitInput,
  outputSchema: z.object({ state: RunState }),
})
  .then(scoreStep)
  .then(clusterStep)
  .then(proposeStep)
  .then(rescoreStep)
  .then(stopCheckStep)
  // Week 4 will replace .then(stopCheckStep) with .until() + branching to
  // re-enter clusterStep when shouldContinue is true.
  .commit();
