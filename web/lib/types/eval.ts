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
  /**
   * System message prepended to every question. Used by the closed-loop
   * optimizer to inject patched instructions + few-shot examples. Stays
   * in sync with `deepeval-svc/app/types.py::SutConfig.system_prompt`.
   */
  system_prompt: z.string().optional(),
});
export type SutConfig = z.infer<typeof SutConfig>;

// ---------- Rubric ----------

/**
 * Full RAGAS rubric — same 7 metrics the desci-dkg evals use.
 *
 *   Context metrics (only meaningful when `context` is supplied):
 *     context_precision / context_recall / context_relevancy
 *   Answer metrics (always run):
 *     answer_relevance / answer_correctness / answer_similarity / faithfulness
 *
 * Mirror of `deepeval-svc/app/types.py::Rubric`. Keep in sync.
 */
export const Rubric = z.object({
  context_precision_weight: z.number().min(0).max(1).default(0),
  context_recall_weight: z.number().min(0).max(1).default(0),
  context_relevancy_weight: z.number().min(0).max(1).default(0),
  answer_relevance_weight: z.number().min(0).max(1).default(0.25),
  answer_correctness_weight: z.number().min(0).max(1).default(0.25),
  answer_similarity_weight: z.number().min(0).max(1).default(0.25),
  faithfulness_weight: z.number().min(0).max(1).default(0.25),

  context_precision_threshold: z.number().min(0).max(1).default(0.8),
  context_recall_threshold: z.number().min(0).max(1).default(0.8),
  context_relevancy_threshold: z.number().min(0).max(1).default(0.8),
  answer_relevance_threshold: z.number().min(0).max(1).default(0.8),
  answer_correctness_threshold: z.number().min(0).max(1).default(0.8),
  answer_similarity_threshold: z.number().min(0).max(1).default(0.8),
  faithfulness_threshold: z.number().min(0).max(1).default(0.7),

  pass_threshold: z.number().min(0).max(1).default(0.7),
});

/** Display order + labels for the 7 RAGAS metrics — matches desci-dkg. */
export const RAGAS_METRIC_DISPLAY: { key: string; label: string; emoji: string; isContext: boolean }[] = [
  { key: 'context_precision',  label: 'Context Precision',  emoji: '🎯', isContext: true },
  { key: 'context_recall',     label: 'Context Recall',     emoji: '🎯', isContext: true },
  { key: 'context_relevancy',  label: 'Context Relevancy',  emoji: '🎯', isContext: true },
  { key: 'answer_relevance',   label: 'Answer Relevance',   emoji: '💬', isContext: false },
  { key: 'answer_correctness', label: 'Answer Correctness', emoji: '✅', isContext: false },
  { key: 'answer_similarity',  label: 'Answer Similarity',  emoji: '🔄', isContext: false },
  { key: 'faithfulness',       label: 'Faithfulness',       emoji: '🔒', isContext: false },
];
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

/**
 * Diagnostic block — mirrors the desci-dkg "WHAT NEEDS TO REACH 100%"
 * section. Generated alongside scoring (one extra judge call per failing
 * case). Feeds the patch proposer with structured, actionable gaps.
 */
export const GapAnalysis = z.object({
  missing_triples: z.array(z.string()).default([]),
  missing_knowledge: z.array(z.string()).default([]),
  missing_data_points: z.array(z.string()).default([]),
  missing_key_terms: z.array(z.string()).default([]),
  score_gap_reason: z.string().default(''),
  projected_score: z.number().min(0).max(1).default(0),
});
export type GapAnalysis = z.infer<typeof GapAnalysis>;

export const CaseResult = z.object({
  case_id: z.string(),
  actual: z.string(),
  score: z.number().min(0).max(1),
  passed: z.boolean(),
  sub_scores: z.record(z.number()).default({}),
  sub_passed: z.record(z.boolean()).default({}),
  judge_reasoning: z.string(),
  response_time_seconds: z.number().min(0).default(0),
  error: z.string().nullable().optional(),
  gap_analysis: GapAnalysis.nullable().optional(),
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

/**
 * One snapshot of the run at a given round. The reports view in the UI
 * scrolls through these like the desci-dkg comparison reports do —
 * round 0 vs round 1 vs round 2 — so customers can see the trajectory.
 */
export const RoundReport = z.object({
  round: z.number().int().min(0),
  label: z.string(), // e.g. "Round 0 — baseline" / "Round 1 — patch A applied"
  results: ScoreBatchResponse,
  clusters: z.array(Cluster).default([]),
  patch_applied: Patch.nullable().optional(),
  generated_at: z.string(),
});
export type RoundReport = z.infer<typeof RoundReport>;

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
  reports: z.array(RoundReport).default([]),
  /** The original eval cases (question + expected). Stored on the run so
   *  reports can render full text without re-fetching from a DB. */
  input_cases: z.array(EvalCase).default([]),
  error: z.string().nullable().optional(),
});
export type RunState = z.infer<typeof RunState>;
