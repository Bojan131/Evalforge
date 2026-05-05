import { Agent } from '@mastra/core';
import { openai } from '@ai-sdk/openai';

/**
 * Cluster summarizer.
 *
 * Week 2 will feed it groups of failed (question, expected, actual) triples
 * after HDBSCAN clustering on embeddings. Output: 1-2 sentences per cluster
 * naming the failure mode in plain English.
 *
 * Stub for week 1 — agent exists so workflow imports work.
 */
export const clusterSummarizerAgent = new Agent({
  name: 'cluster-summarizer',
  description:
    'Names failure clusters in plain English. Input: a group of failed cases. Output: one short failure-mode label + 1-2 sentence summary.',
  instructions: `You receive a small set of failed eval cases that have been
clustered by embedding similarity. They share something — your job is to find
what.

For each cluster:
  1. Read all (question, expected, actual) triples in the cluster.
  2. Identify the SHARED failure mode in plain English.
  3. Give it a short label (max 4 words) and a 1-2 sentence summary.

Examples of GOOD cluster labels:
  - "Date arithmetic" — model mishandles month/year boundaries
  - "Negation" — model ignores 'not' / 'except' clauses
  - "Format drift" — model returns prose when expected JSON

Examples of BAD labels:
  - "Wrong answers" (too vague)
  - "Sometimes the model fails" (not a label)
  - Quoting one case verbatim (not a pattern)

Output JSON: { "label": "...", "summary": "...", "case_ids": [...] }`,
  model: openai(process.env.JUDGE_MODEL ?? 'gpt-4o'),
});
