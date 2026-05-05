import { createTool } from '@mastra/core';
import { z } from 'zod';
import { ScoreBatchRequest, ScoreBatchResponse } from '@/lib/types/eval';

const DEEPEVAL_URL = process.env.DEEPEVAL_URL ?? 'http://localhost:8787';

/**
 * The single bridge between Mastra and the DeepEval Python sidecar.
 * Every score-related call funnels through here so we can:
 *   - swap the URL via env (local dev → staging → prod)
 *   - centralise retry / timeout / error mapping
 *   - log judge model + spend per call to telemetry
 */
export const callDeepEval = createTool({
  id: 'call-deepeval',
  description:
    'Score an eval batch against a SUT (system-under-test) endpoint. Returns per-case + overall scores.',
  inputSchema: ScoreBatchRequest,
  outputSchema: ScoreBatchResponse,
  execute: async ({ context }) => {
    const r = await fetch(`${DEEPEVAL_URL}/score`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(context),
      // DeepEval scores 50 cases in ~30s on gpt-4o; keep timeout generous
      signal: AbortSignal.timeout(180_000),
    });
    if (!r.ok) {
      throw new Error(
        `DeepEval sidecar returned ${r.status}: ${(await r.text()).slice(0, 500)}`
      );
    }
    return ScoreBatchResponse.parse(await r.json());
  },
});

/**
 * Health probe — used by API routes to surface a clear "Python sidecar not
 * running" error to the user before they fill out a 30-question form.
 */
export async function probeDeepEvalHealth(): Promise<{
  ok: boolean;
  judge_model?: string;
  error?: string;
}> {
  try {
    const r = await fetch(`${DEEPEVAL_URL}/health`, {
      signal: AbortSignal.timeout(2_000),
    });
    if (!r.ok) return { ok: false, error: `HTTP ${r.status}` };
    const data = (await r.json()) as { judge_model?: string };
    return { ok: true, judge_model: data.judge_model };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'unknown' };
  }
}

// Helper input type — exported so workflow steps don't have to import zod schema
export type CallDeepEvalInput = z.input<typeof ScoreBatchRequest>;
