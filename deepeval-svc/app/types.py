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


# ---------- Rubric (judge config) ----------


class Rubric(BaseModel):
    """Default rubric. Customers can override via the form."""

    correctness_weight: float = 0.5
    completeness_weight: float = 0.2
    hallucination_weight: float = 0.2
    format_weight: float = 0.1
    threshold: float = Field(default=0.7, ge=0.0, le=1.0, description="Score >= threshold = pass")


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
        description="Per-criterion scores: correctness, completeness, hallucination, format",
    )
    judge_reasoning: str
    error: Optional[str] = None


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
