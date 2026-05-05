/**
 * Mastra entrypoint — single object the rest of the app imports.
 *
 * Orchestrates the closed-loop eval pipeline. Week 1 has the `score` step
 * fully wired against the DeepEval Python sidecar; clustering, patch-
 * proposal, and the loop controller are typed-but-stubbed so weeks 2-4
 * slot in cleanly without rewiring upstream.
 *
 * Why Mastra (vs raw Vercel AI SDK):
 *   - Workflow primitive with stop conditions = our pipeline natively
 *   - Built-in memory + telemetry per run = audit log free
 *   - Agent abstraction with tools + retries built in
 *   - Sits on top of Vercel AI SDK so we still get every model provider
 *
 * If a step needs Python (DeepEval, DSPy, HDBSCAN), it goes via a tool
 * that calls our sidecar over HTTP — never spawn Python from Node.
 */

import { Mastra } from '@mastra/core';
import { evalRunWorkflow } from './workflows/eval-run';
import { judgeAgent } from './agents/judge';
import { clusterSummarizerAgent } from './agents/cluster-summarizer';
import { patchProposerAgent } from './agents/patch-proposer';

export const mastra = new Mastra({
  workflows: { evalRunWorkflow },
  agents: { judgeAgent, clusterSummarizerAgent, patchProposerAgent },
  // Telemetry can be wired to Langfuse/Phoenix later. For week 1 we use
  // Mastra's default in-memory store; production swaps in Postgres.
});
