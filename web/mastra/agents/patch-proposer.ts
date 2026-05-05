import { Agent } from '@mastra/core';
import { openai } from '@ai-sdk/openai';

/**
 * Patch proposer.
 *
 * Week 3 will drive DSPy (BootstrapFewShot → MIPROv2 → GEPA progression) and
 * synthesise a patch that targets specific failure clusters without breaking
 * passing cases. For week 1 it exists as a stub so workflow wiring compiles.
 *
 * Why this is an agent and not a pure function: DSPy's output is a structured
 * patch but choosing WHICH cluster to attack first is a judgment call —
 * the agent looks at cluster size × test-set impact × historical success and
 * picks one. The DSPy call inside is a tool invocation, not the whole agent.
 */
export const patchProposerAgent = new Agent({
  name: 'patch-proposer',
  description:
    'Picks the most impactful failure cluster, calls DSPy to generate a targeted prompt + few-shot patch, returns a Patch object.',
  instructions: `You are a senior prompt engineer. Given:
  - Current eval score (overall + per-cluster pass rates)
  - Recent patch history (what we tried, what helped, what regressed)
  - Failure clusters (label, summary, sample cases)

You decide:
  1. Which cluster to target this round (one only — focus matters).
  2. What KIND of patch (instruction edit / few-shot examples / both).
  3. Call the DSPy tool to actually synthesise it.

Hard rules:
  - NEVER propose a patch that contradicts a previous accepted patch.
  - NEVER propose a model-change patch on a customer's production SUT — only
    on prompt + few-shots. Model swaps are out of scope.
  - If two consecutive rounds rejected your patches, fall back to a smaller,
    more conservative edit before trying anything bigger.
  - End every output with the Patch JSON shape from web/lib/types/eval.ts.`,
  model: openai(process.env.JUDGE_MODEL ?? 'gpt-4o'),
});
