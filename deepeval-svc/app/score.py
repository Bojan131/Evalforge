"""DeepEval-backed scoring.

This module is the only place that touches DeepEval directly. It owns:
  1. Calling the customer's SUT (system-under-test) endpoint per case.
  2. Building DeepEval LLMTestCase objects.
  3. Running the GEval rubric judge.
  4. Folding sub-scores into one composite per case.

We use DeepEval's GEval because it's their flagship rubric-based judge:
  - Chain-of-thought reasoning is built in
  - Multi-criterion scoring out of the box
  - Plays nicely with any judge model OpenAI-compatible

If we ever need pure RAG metrics (faithfulness, contextual precision/recall),
those are also in DeepEval — we'd add them as additional metrics on the same
LLMTestCase. Holding off until a customer asks; the GEval rubric covers
RAG-shaped use cases when `context` is filled in.
"""

from __future__ import annotations

import asyncio
import os
import time
from typing import Any, Optional

import httpx

from app.types import (
    CaseResult,
    EvalCase,
    GapAnalysis,
    Rubric,
    ScoreBatchRequest,
    ScoreBatchResponse,
    ScoreSingleRequest,
    ScoreSingleResponse,
    SutConfig,
)

# DeepEval imports are deferred to avoid slow startup when the service is
# only being asked /health.
def _judge():
    """Lazy DeepEval import + GEval factory."""
    from deepeval.metrics import GEval  # type: ignore
    from deepeval.test_case import LLMTestCaseParams  # type: ignore

    judge_model = os.getenv("JUDGE_MODEL", "gpt-4o")

    def make_metric(name: str, criterion: str, weight: float) -> GEval:
        return GEval(
            name=name,
            criteria=criterion,
            evaluation_params=[
                LLMTestCaseParams.INPUT,
                LLMTestCaseParams.ACTUAL_OUTPUT,
                LLMTestCaseParams.EXPECTED_OUTPUT,
                LLMTestCaseParams.CONTEXT,
            ],
            model=judge_model,
            threshold=0.5,
            async_mode=True,
            verbose_mode=False,
        )

    return make_metric, judge_model


# ---------- SUT (system under test) call ----------


async def _call_sut(client: httpx.AsyncClient, sut: SutConfig, question: str) -> str:
    """POST the question to the customer's endpoint. We assume an OpenAI-shaped
    chat-completions response by default. If the customer has a non-standard
    shape, they should put a tiny adapter in front of their API.
    """
    headers = {"Content-Type": "application/json", **sut.extra_headers}
    if sut.api_key:
        headers["Authorization"] = f"Bearer {sut.api_key}"

    # Build the messages array. If we have a system_prompt (from the closed-
    # loop optimizer's patch), it MUST go as a real system message — not a
    # header — because that's the only way the SUT will actually attend to it.
    messages: list[dict[str, str]] = []
    if sut.system_prompt:
        messages.append({"role": "system", "content": sut.system_prompt})
    messages.append({"role": "user", "content": question})

    payload: dict[str, Any] = {"messages": messages}
    if sut.model:
        payload["model"] = sut.model

    try:
        r = await client.post(
            str(sut.endpoint), json=payload, headers=headers, timeout=sut.timeout_seconds
        )
        r.raise_for_status()
        data = r.json()
    except httpx.HTTPError as e:
        raise RuntimeError(f"SUT call failed: {e}") from e

    # Try OpenAI shape first, fall back to a few common alternatives.
    try:
        return data["choices"][0]["message"]["content"]
    except (KeyError, IndexError, TypeError):
        pass
    for k in ("output", "answer", "response", "text", "completion"):
        if isinstance(data, dict) and k in data and isinstance(data[k], str):
            return data[k]
    # Last resort: stringify the whole thing so the judge has SOMETHING to grade.
    return str(data)


# ---------- DeepEval per-case ----------


# Criteria text per metric — these are the rubrics the GEval judge sees.
# Phrased to match the RAGAS / desci-dkg semantics customers expect.
_METRIC_CRITERIA = {
    "context_precision": (
        "Of the provided context, how much is actually relevant to the question? "
        "Penalize noise / irrelevant chunks. Match RAGAS Context Precision."
    ),
    "context_recall": (
        "Did the provided context cover EVERY fact needed to produce the expected "
        "answer? Penalize gaps. Match RAGAS Context Recall."
    ),
    "context_relevancy": (
        "How useful is the retrieved context to the user's question? "
        "Match RAGAS Context Relevancy."
    ),
    "answer_relevance": (
        "Does the actual output ACTUALLY ANSWER the question? Off-topic or evasive "
        "answers score low even if factually true. Match RAGAS Answer Relevance."
    ),
    "answer_correctness": (
        "Is the actual output FACTUALLY correct vs the expected output? Penalize "
        "wrong facts heavily. Reward each correct fact. Headline metric — match "
        "RAGAS / desci-dkg Answer Correctness."
    ),
    "answer_similarity": (
        "How semantically similar is the actual output to the expected? Two answers "
        "can both be correct; we want the one closer in meaning. RAGAS Answer Similarity."
    ),
    "faithfulness": (
        "Is every claim in the actual output supported by the provided context (if "
        "any) or by the expected output? Penalize hallucinations heavily. RAGAS Faithfulness."
    ),
}


async def _score_case(case: EvalCase, actual: str, rubric: Rubric, response_time_s: float = 0.0) -> CaseResult:
    """Full RAGAS-style scoring — up to 7 metrics, configurable per rubric.

    Mirrors the desci-dkg eval framework. The composite "Correctness Score"
    is the weighted mean of ACTIVE metrics (weight > 0). After scoring a
    failing case we run a second judge pass to produce the structured gap
    analysis — exactly what feeds into the desci-dkg "WHAT NEEDS TO REACH
    100%" block and into our patch proposer downstream.
    """
    from deepeval.test_case import LLMTestCase  # type: ignore

    make_metric, _judge_model = _judge()
    test_case = LLMTestCase(
        input=case.question,
        actual_output=actual,
        expected_output=case.expected,
        context=[case.context] if case.context else None,
    )

    sub_scores: dict[str, float] = {}
    metric_passed: dict[str, bool] = {}
    reasoning_parts: list[str] = []
    weight_sum = 0.0
    weighted_total = 0.0

    for name, weight, threshold in rubric.active_metrics:
        # Skip context_* metrics if no context was supplied — they'd score 0
        # mechanically and pull the composite down for non-RAG SUTs.
        if name.startswith("context_") and not case.context:
            continue
        criterion = _METRIC_CRITERIA[name]
        metric = make_metric(name, criterion, weight)
        try:
            await metric.a_measure(test_case)
            score = float(metric.score or 0.0)
            sub_scores[name] = score
            metric_passed[name] = score >= threshold
            weighted_total += score * weight
            weight_sum += weight
            if metric.reason:
                reasoning_parts.append(f"[{name}] {metric.reason}")
        except Exception as e:
            sub_scores[name] = 0.0
            metric_passed[name] = False
            reasoning_parts.append(f"[{name}] judge error: {e}")

    composite = (weighted_total / weight_sum) if weight_sum > 0 else 0.0

    # Gap analysis only when below perfect — saves judge tokens.
    gap_analysis: Optional[GapAnalysis] = None
    if composite < 1.0:
        try:
            gap_analysis = await _generate_gap_analysis(case, actual, composite)
        except Exception:
            pass

    return CaseResult(
        case_id=case.id,
        actual=actual,
        score=composite,
        passed=composite >= rubric.pass_threshold,
        sub_scores=sub_scores,
        sub_passed=metric_passed,
        judge_reasoning="\n".join(reasoning_parts),
        response_time_seconds=response_time_s,
        gap_analysis=gap_analysis,
    )


async def _generate_gap_analysis(case: EvalCase, actual: str, score: float) -> GapAnalysis:
    """Run a focused judge pass that produces the desci-dkg-style diagnostic
    block: what triples / knowledge / data points / key terms are missing,
    and what would the projected score be if they were addressed.

    This is what feeds the patch proposer downstream — concrete deltas, not
    vibes. Patches target named gaps; reports show named gaps.
    """
    from openai import OpenAI

    client = OpenAI()
    judge_model = os.getenv("JUDGE_MODEL", "gpt-4o")

    prompt = f"""You are a strict evaluator producing a structured "what needs to reach 100%" diagnostic.

Question: {case.question}

Expected answer: {case.expected}

Actual answer: {actual}

Current score: {round(score * 100)}%

Identify what's missing in the actual answer compared to the expected. Be specific and actionable.
Return JSON in EXACTLY this shape (no markdown):

{{
  "missing_triples": ["<subject-predicate-object facts the actual answer omitted>"],
  "missing_knowledge": ["<concepts/topics from expected that aren't in actual>"],
  "missing_data_points": ["<specific numbers, dates, names, identifiers omitted>"],
  "missing_key_terms": ["<technical terms from expected not used in actual>"],
  "score_gap_reason": "<one sentence explaining the score gap>",
  "projected_score": <float 0..1 — score if every missing item were added>
}}

Empty arrays are valid if nothing is missing in that category. Keep each list item ≤ 80 chars."""

    resp = client.chat.completions.create(
        model=judge_model,
        messages=[{"role": "user", "content": prompt}],
        response_format={"type": "json_object"},
        temperature=0.1,
    )
    raw = resp.choices[0].message.content or "{}"
    import json

    try:
        d = json.loads(raw)
        return GapAnalysis(
            missing_triples=[str(x)[:120] for x in d.get("missing_triples", [])][:10],
            missing_knowledge=[str(x)[:120] for x in d.get("missing_knowledge", [])][:10],
            missing_data_points=[str(x)[:120] for x in d.get("missing_data_points", [])][:10],
            missing_key_terms=[str(x)[:120] for x in d.get("missing_key_terms", [])][:15],
            score_gap_reason=str(d.get("score_gap_reason", ""))[:300],
            projected_score=float(d.get("projected_score", score)),
        )
    except (json.JSONDecodeError, ValueError, TypeError):
        return GapAnalysis(score_gap_reason="Gap analysis parse failed", projected_score=score)


async def _score_one_with_sut(
    client: httpx.AsyncClient, case: EvalCase, sut: SutConfig, rubric: Rubric
) -> CaseResult:
    sut_started = time.time()
    try:
        actual = await _call_sut(client, sut, case.question)
    except Exception as e:
        return CaseResult(
            case_id=case.id,
            actual="",
            score=0.0,
            passed=False,
            sub_scores={},
            judge_reasoning="",
            response_time_seconds=round(time.time() - sut_started, 2),
            error=str(e),
        )
    sut_elapsed = round(time.time() - sut_started, 2)
    try:
        return await _score_case(case, actual, rubric, response_time_s=sut_elapsed)
    except Exception as e:
        return CaseResult(
            case_id=case.id,
            actual=actual,
            score=0.0,
            passed=False,
            sub_scores={},
            judge_reasoning="",
            response_time_seconds=sut_elapsed,
            error=f"judge failed: {e}",
        )


# ---------- public entry points ----------


async def score_batch(req: ScoreBatchRequest) -> ScoreBatchResponse:
    started = time.time()
    sem = asyncio.Semaphore(req.max_concurrency)

    async with httpx.AsyncClient() as client:
        async def bounded(case: EvalCase) -> CaseResult:
            async with sem:
                return await _score_one_with_sut(client, case, req.sut, req.rubric)

        results = await asyncio.gather(*(bounded(c) for c in req.cases))

    weight_sum = sum(c.weight for c in req.cases) or 1.0
    weighted_score = (
        sum(r.score * c.weight for r, c in zip(results, req.cases)) / weight_sum
    )
    pass_rate = sum(1 for r in results if r.passed) / max(1, len(results))

    return ScoreBatchResponse(
        run_id=req.run_id,
        overall_score=weighted_score,
        pass_rate=pass_rate,
        cases=results,
        judge_model=os.getenv("JUDGE_MODEL", "gpt-4o"),
        judge_provider=os.getenv("JUDGE_PROVIDER", "openai"),
        elapsed_seconds=round(time.time() - started, 2),
    )


async def score_one(req: ScoreSingleRequest) -> ScoreSingleResponse:
    started = time.time()
    async with httpx.AsyncClient() as client:
        result = await _score_one_with_sut(client, req.case, req.sut, req.rubric)
    return ScoreSingleResponse(
        case=result,
        judge_model=os.getenv("JUDGE_MODEL", "gpt-4o"),
        judge_provider=os.getenv("JUDGE_PROVIDER", "openai"),
        elapsed_seconds=round(time.time() - started, 2),
    )
