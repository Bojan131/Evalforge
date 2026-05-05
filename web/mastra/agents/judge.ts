import { Agent } from '@mastra/core';
import { openai } from '@ai-sdk/openai';

/**
 * Judge agent.
 *
 * Most rubric scoring happens INSIDE the DeepEval sidecar (it has its own
 * judge invocation pipeline + chain-of-thought). This Mastra-level agent is
 * only used for follow-up rubric work the sidecar doesn't do — eg. asking
 * "given this batch result, is the judge being too lenient on hallucination?"
 * We invoke it sparingly and log its calls so judge drift is visible.
 *
 * Strict isolation rule: do NOT use the same model family as the customer's
 * SUT here. We default to gpt-4o; if customer is GPT-shaped, swap via env.
 */
export const judgeAgent = new Agent({
  name: 'judge',
  description:
    'Rubric-based meta-judge. Sanity-checks DeepEval batch results, flags judge drift, never scores directly.',
  instructions: `You are a meta-judge. You DO NOT score outputs directly — that's
DeepEval's job. Your job is to look at a batch of judge reasoning and answer
questions like:
  - Are the sub-scores internally consistent? (eg. "complete" but score 0.4)
  - Is the judge too lenient or too harsh on a specific criterion?
  - Are there cases where the rubric was clearly mis-applied?

Always cite specific case IDs in your answers. Never invent reasoning.`,
  model: openai(process.env.JUDGE_MODEL ?? 'gpt-4o'),
});
