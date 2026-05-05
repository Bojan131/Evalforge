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
from typing import Any

import httpx

from app.types import (
    CaseResult,
    EvalCase,
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


async def _score_case(case: EvalCase, actual: str, rubric: Rubric) -> CaseResult:
    from deepeval.test_case import LLMTestCase  # type: ignore

    make_metric, _judge_model = _judge()

    # Each metric is one criterion. We weight them per the rubric and average.
    metrics = {
        "correctness": (
            make_metric(
                "correctness",
                "Determine if the actual output is FACTUALLY correct given the expected output. "
                "Penalize wrong facts. Reward correct facts.",
                rubric.correctness_weight,
            ),
            rubric.correctness_weight,
        ),
        "completeness": (
            make_metric(
                "completeness",
                "Does the actual output cover ALL key points from the expected output? "
                "Penalize missing information. Reward complete coverage.",
                rubric.completeness_weight,
            ),
            rubric.completeness_weight,
        ),
        "hallucination": (
            make_metric(
                "hallucination",
                "Does the actual output INVENT facts not supported by the expected output or context? "
                "A high score means LOW hallucination. Penalize fabricated facts heavily.",
                rubric.hallucination_weight,
            ),
            rubric.hallucination_weight,
        ),
        "format": (
            make_metric(
                "format",
                "Does the actual output match the format/structure of the expected output? "
                "(JSON shape, list vs prose, length norms.)",
                rubric.format_weight,
            ),
            rubric.format_weight,
        ),
    }

    test_case = LLMTestCase(
        input=case.question,
        actual_output=actual,
        expected_output=case.expected,
        context=[case.context] if case.context else None,
    )

    sub_scores: dict[str, float] = {}
    reasoning_parts: list[str] = []
    weight_sum = 0.0
    weighted_total = 0.0

    for name, (metric, w) in metrics.items():
        if w <= 0:
            continue
        try:
            await metric.a_measure(test_case)
            score = float(metric.score or 0.0)
            sub_scores[name] = score
            weighted_total += score * w
            weight_sum += w
            if metric.reason:
                reasoning_parts.append(f"[{name}] {metric.reason}")
        except Exception as e:  # one bad metric shouldn't kill the batch
            sub_scores[name] = 0.0
            reasoning_parts.append(f"[{name}] judge error: {e}")

    composite = (weighted_total / weight_sum) if weight_sum > 0 else 0.0
    return CaseResult(
        case_id=case.id,
        actual=actual,
        score=composite,
        passed=composite >= rubric.threshold,
        sub_scores=sub_scores,
        judge_reasoning="\n".join(reasoning_parts),
    )


async def _score_one_with_sut(
    client: httpx.AsyncClient, case: EvalCase, sut: SutConfig, rubric: Rubric
) -> CaseResult:
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
            error=str(e),
        )
    try:
        return await _score_case(case, actual, rubric)
    except Exception as e:
        return CaseResult(
            case_id=case.id,
            actual=actual,
            score=0.0,
            passed=False,
            sub_scores={},
            judge_reasoning="",
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
