"""Pydantic types shared between the Node side and the Python sidecar.

Keep these in sync with `web/lib/types/eval.ts` — same field names, same
shapes, so we never have to translate between two type systems. If you
change one, change the other.
"""

from __future__ import annotations

from typing import Literal, Optional

from pydantic import BaseModel, Field, HttpUrl


# ---------- Eval case ----------

EvalCategory = Literal[
    "factual", "reasoning", "summarization", "code", "creative", "edge_case", "other"
]


class EvalCase(BaseModel):
    id: str = Field(..., description="Stable user-supplied or generated ID")
    question: str
    expected: str
    context: Optional[str] = Field(
        default=None,
        description="Ground-truth context (RAG passages, system facts). Optional.",
    )
    category: EvalCategory = "other"
    weight: float = Field(default=1.0, ge=0.0, le=10.0)


# ---------- SUT (system-under-test) config ----------


class SutConfig(BaseModel):
    """Where to send each question. We treat the customer's AI as a black box —
    we POST the question, we read the answer. Schema mimics OpenAI chat-
    completions so 95% of customer endpoints work without translation."""

    endpoint: HttpUrl
    api_key: Optional[str] = Field(default=None, description="Bearer token if needed")
    model: Optional[str] = None
    timeout_seconds: int = Field(default=60, ge=1, le=300)
    extra_headers: dict[str, str] = Field(default_factory=dict)
    system_prompt: Optional[str] = Field(
        default=None,
        description=(
            "System message prepended to every question. Used by the closed-loop "
            "optimizer to inject patched instructions + few-shot examples. The "
            "customer's original system prompt (if any) lives upstream of us; we "
            "only add to it via this field."
        ),
    )


# ---------- Rubric (judge config) ----------


class Rubric(BaseModel):
    """Full RAGAS rubric — same 7 metrics the desci-dkg evals use:

      Context metrics (only meaningful when `context` is provided — RAG case):
        - context_precision   How precise is the retrieved context
        - context_recall      Did retrieval find everything relevant
        - context_relevancy   Is the context useful for the question

      Answer metrics (always meaningful):
        - answer_relevance    Does the answer address the question
        - answer_correctness  Is the answer factually correct  ← headline
        - answer_similarity   How close to the expected wording
        - faithfulness        Stays grounded in source / no hallucination

    Per-metric thresholds match the desci-dkg defaults (0.7 / 0.8). A case
    "passes" when its weighted composite >= `pass_threshold`. Per-metric
    pass/fail is also tracked individually for the dashboard breakdown.
    """

    # --- weights (0..1; if non-zero, the metric runs) ---
    context_precision_weight: float = 0.0  # default 0 — most non-RAG SUTs lack context
    context_recall_weight: float = 0.0
    context_relevancy_weight: float = 0.0
    answer_relevance_weight: float = 0.25
    answer_correctness_weight: float = 0.25
    answer_similarity_weight: float = 0.25
    faithfulness_weight: float = 0.25

    # --- per-metric pass thresholds ---
    context_precision_threshold: float = 0.8
    context_recall_threshold: float = 0.8
    context_relevancy_threshold: float = 0.8
    answer_relevance_threshold: float = 0.8
    answer_correctness_threshold: float = 0.8
    answer_similarity_threshold: float = 0.8
    faithfulness_threshold: float = 0.7

    # --- composite pass threshold (case-level) ---
    pass_threshold: float = Field(
        default=0.7, ge=0.0, le=1.0,
        description="Score >= this = case passed (used by regression guard).",
    )

    @property
    def active_metrics(self) -> list[tuple[str, float, float]]:
        """Return [(name, weight, threshold), ...] for metrics with weight > 0.
        The list drives _score_case so adding/removing metrics is purely a
        rubric-config concern, never a code change."""
        return [
            (n, w, t) for (n, w, t) in (
                ("context_precision",  self.context_precision_weight,  self.context_precision_threshold),
                ("context_recall",     self.context_recall_weight,     self.context_recall_threshold),
                ("context_relevancy",  self.context_relevancy_weight,  self.context_relevancy_threshold),
                ("answer_relevance",   self.answer_relevance_weight,   self.answer_relevance_threshold),
                ("answer_correctness", self.answer_correctness_weight, self.answer_correctness_threshold),
                ("answer_similarity",  self.answer_similarity_weight,  self.answer_similarity_threshold),
                ("faithfulness",       self.faithfulness_weight,       self.faithfulness_threshold),
            ) if w > 0
        ]


# ---------- Requests ----------


class ScoreBatchRequest(BaseModel):
    run_id: str
    cases: list[EvalCase]
    sut: SutConfig
    rubric: Rubric = Field(default_factory=Rubric)
    max_concurrency: int = Field(default=8, ge=1, le=32)


class ScoreSingleRequest(BaseModel):
    case: EvalCase
    sut: SutConfig
    rubric: Rubric = Field(default_factory=Rubric)


# ---------- Responses ----------


class CaseResult(BaseModel):
    case_id: str
    actual: str
    score: float = Field(..., ge=0.0, le=1.0)
    passed: bool
    sub_scores: dict[str, float] = Field(
        default_factory=dict,
        description=(
            "Per-metric scores keyed by RAGAS metric name: "
            "context_precision/recall/relevancy, answer_relevance/correctness/similarity, faithfulness."
        ),
    )
    sub_passed: dict[str, bool] = Field(
        default_factory=dict,
        description="Per-metric pass/fail using the rubric's per-metric thresholds.",
    )
    judge_reasoning: str
    response_time_seconds: float = Field(default=0.0, ge=0.0)
    error: Optional[str] = None
    # Diagnostic block — what needs to reach 100%. Optional because not
    # every judge invocation produces it (saves judge tokens on cheap calls).
    gap_analysis: Optional["GapAnalysis"] = None


class GapAnalysis(BaseModel):
    """Mirrors the desci-dkg 'WHAT NEEDS TO REACH 100%' diagnostic block.
    Generated by the judge alongside the score so the patch proposer has
    a structured, per-case breakdown to act on."""

    missing_triples: list[str] = Field(default_factory=list)
    missing_knowledge: list[str] = Field(default_factory=list)
    missing_data_points: list[str] = Field(default_factory=list)
    missing_key_terms: list[str] = Field(default_factory=list)
    score_gap_reason: str = ""
    projected_score: float = Field(default=0.0, ge=0.0, le=1.0)


class ScoreBatchResponse(BaseModel):
    run_id: str
    overall_score: float
    pass_rate: float
    cases: list[CaseResult]
    judge_model: str
    judge_provider: str
    elapsed_seconds: float


class ScoreSingleResponse(BaseModel):
    case: CaseResult
    judge_model: str
    judge_provider: str
    elapsed_seconds: float


class HealthResponse(BaseModel):
    status: str
    judge_model: str
    judge_provider: str
    version: str
