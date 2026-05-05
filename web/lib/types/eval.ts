/**
 * Shared types between the Next.js app and the Python DeepEval sidecar.
 * MUST stay in sync with `deepeval-svc/app/types.py`. If you change one,
 * change the other in the same commit.
 */

import { z } from 'zod';

// ---------- Eval case ----------

export const EvalCategory = z.enum([
  'factual',
  'reasoning',
  'summarization',
  'code',
  'creative',
  'edge_case',
  'other',
]);
export type EvalCategory = z.infer<typeof EvalCategory>;

export const EvalCase = z.object({
  id: z.string().min(1),
  question: z.string().min(1),
  expected: z.string().min(1),
  context: z.string().optional(),
  category: EvalCategory.default('other'),
  weight: z.number().min(0).max(10).default(1),
});
export type EvalCase = z.infer<typeof EvalCase>;

// ---------- SUT (system under test) ----------

export const SutConfig = z.object({
  endpoint: z.string().url(),
  api_key: z.string().optional(),
  model: z.string().optional(),
  timeout_seconds: z.number().int().min(1).max(300).default(60),
  extra_headers: z.record(z.string()).default({}),
});
export type SutConfig = z.infer<typeof SutConfig>;

// ---------- Rubric ----------

export const Rubric = z.object({
  correctness_weight: z.number().min(0).max(1).default(0.5),
  completeness_weight: z.number().min(0).max(1).default(0.2),
  hallucination_weight: z.number().min(0).max(1).default(0.2),
  format_weight: z.number().min(0).max(1).default(0.1),
  threshold: z.number().min(0).max(1).default(0.7),
});
export type Rubric = z.infer<typeof Rubric>;

// ---------- Requests / responses ----------

export const ScoreBatchRequest = z.object({
  run_id: z.string(),
  cases: z.array(EvalCase).min(1),
  sut: SutConfig,
  rubric: Rubric.optional(),
  max_concurrency: z.number().int().min(1).max(32).default(8),
});
export type ScoreBatchRequest = z.infer<typeof ScoreBatchRequest>;

export const CaseResult = z.object({
  case_id: z.string(),
  actual: z.string(),
  score: z.number().min(0).max(1),
  passed: z.boolean(),
  sub_scores: z.record(z.number()).default({}),
  judge_reasoning: z.string(),
  error: z.string().nullable().optional(),
});
export type CaseResult = z.infer<typeof CaseResult>;

export const ScoreBatchResponse = z.object({
  run_id: z.string(),
  overall_score: z.number().min(0).max(1),
  pass_rate: z.number().min(0).max(1),
  cases: z.array(CaseResult),
  judge_model: z.string(),
  judge_provider: z.string(),
  elapsed_seconds: z.number(),
});
export type ScoreBatchResponse = z.infer<typeof ScoreBatchResponse>;

// ---------- Run state (Mastra workflow output) ----------

export const RunStatus = z.enum([
  'queued',
  'scoring',
  'clustering',
  'proposing',
  'rescoring',
  'done',
  'failed',
]);
export type RunStatus = z.infer<typeof RunStatus>;

export const Patch = z.object({
  round: z.number().int().min(1),
  prompt_diff: z.string(),
  few_shots_added: z
    .array(z.object({ input: z.string(), output: z.string() }))
    .default([]),
  model_hint: z.string().optional(),
  expected_lift: z.number().optional(),
  applied: z.boolean().default(false),
  accepted: z.boolean().default(false),
  reject_reason: z.string().optional(),
  test_score_before: z.number().optional(),
  test_score_after: z.number().optional(),
});
export type Patch = z.infer<typeof Patch>;

export const Cluster = z.object({
  id: z.string(),
  label: z.string(),
  summary: z.string(),
  case_ids: z.array(z.string()),
  size: z.number().int(),
});
export type Cluster = z.infer<typeof Cluster>;

export const RunState = z.object({
  run_id: z.string(),
  status: RunStatus,
  created_at: z.string(),
  updated_at: z.string(),
  current_round: z.number().int().min(0).default(0),
  initial_score: z.number().min(0).max(1).optional(),
  current_score: z.number().min(0).max(1).optional(),
  goal_score: z.number().min(0).max(1).default(0.95),
  budget_cap_usd: z.number().min(0).default(5),
  spent_usd: z.number().min(0).default(0),
  results: ScoreBatchResponse.optional(),
  clusters: z.array(Cluster).default([]),
  patches: z.array(Patch).default([]),
  error: z.string().nullable().optional(),
});
export type RunState = z.infer<typeof RunState>;
