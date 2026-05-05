/**
 * POST /api/runs — kick off an eval run.
 * GET  /api/runs — list past runs (in-memory for now).
 *
 * Lifecycle:
 *   1. Client submits cases + SUT config + run goals.
 *   2. We start the eval pipeline asynchronously (fire-and-forget).
 *   3. Pipeline calls `sink(state)` after each step → we persist to runStore.
 *   4. UI polls /api/runs/:id every 1.5s.
 *
 * Production hardening (week 5): persist to Postgres, queue via PgBoss/Inngest,
 * SSE stream for live updates instead of polling.
 */

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { runEval } from '@/mastra';
import { runStore } from '@/lib/run-store';
import { EvalCase, RunState, SutConfig, Rubric } from '@/lib/types/eval';
import { probeDeepEvalHealth } from '@/mastra/tools/call-deepeval';
import { shortId } from '@/lib/utils';

const StartRunBody = z.object({
  cases: z.array(EvalCase).min(1).max(200),
  sut: SutConfig,
  rubric: Rubric.optional(),
  goal_score: z.number().min(0).max(1).default(0.95),
  budget_cap_usd: z.number().min(0).max(50).default(5),
  test_split: z.number().min(0.1).max(0.5).default(0.3),
  max_rounds: z.number().int().min(1).max(10).default(5),
});

export async function POST(req: Request) {
  // Fail fast if the Python sidecar is down — saves the user from filling
  // out 30 questions only to hit a connection refused later.
  const health = await probeDeepEvalHealth();
  if (!health.ok) {
    return NextResponse.json(
      {
        error:
          'DeepEval sidecar is not reachable. Start it with `cd deepeval-svc && uvicorn app.main:app --reload --port 8787`.',
        detail: health.error,
      },
      { status: 503 }
    );
  }

  let body: z.infer<typeof StartRunBody>;
  try {
    body = StartRunBody.parse(await req.json());
  } catch (e) {
    return NextResponse.json(
      { error: 'Invalid request body', detail: e instanceof Error ? e.message : String(e) },
      { status: 400 }
    );
  }

  const runId = shortId('run');
  const initial: RunState = {
    run_id: runId,
    status: 'queued',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    current_round: 0,
    goal_score: body.goal_score,
    budget_cap_usd: body.budget_cap_usd,
    spent_usd: 0,
    clusters: [],
    patches: [],
  };
  runStore.set(initial);

  // Fire-and-forget — pipeline updates the store as it goes.
  void runEval(
    {
      run_id: runId,
      cases: body.cases,
      sut: body.sut,
      rubric: body.rubric,
      goal_score: body.goal_score,
      budget_cap_usd: body.budget_cap_usd,
      max_rounds: body.max_rounds,
      test_split: body.test_split,
    },
    (state) => runStore.set(state)
  ).catch((err) => {
    runStore.set({
      ...initial,
      status: 'failed',
      updated_at: new Date().toISOString(),
      error: err instanceof Error ? err.message : String(err),
    });
  });

  return NextResponse.json({ run_id: runId }, { status: 202 });
}

export async function GET() {
  return NextResponse.json({ runs: runStore.list() });
}
