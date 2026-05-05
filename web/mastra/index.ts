/**
 * Mastra entrypoint.
 *
 * We use Mastra for its **agent abstraction** (LLM-call retries, telemetry,
 * memory hooks). The orchestration pipeline (score → cluster → propose →
 * re-score → loop) is plain TypeScript in `workflows/eval-run.ts` because
 * the workflow primitive's generic types fight us hard for compositions
 * with rich state — and our pipeline benefits from straightforward control
 * flow more than it benefits from a DAG runtime.
 *
 * The agents below are used INSIDE the eval-run pipeline whenever an LLM
 * call needs to be made (cluster summarization, patch proposal). They get
 * Mastra's retry + telemetry for free.
 */

import { Mastra } from '@mastra/core';
import { judgeAgent } from './agents/judge';
import { clusterSummarizerAgent } from './agents/cluster-summarizer';
import { patchProposerAgent } from './agents/patch-proposer';

export const mastra = new Mastra({
  agents: { judgeAgent, clusterSummarizerAgent, patchProposerAgent },
});

export { runEval, type RunEvalInput, type RunSink } from './workflows/eval-run';
