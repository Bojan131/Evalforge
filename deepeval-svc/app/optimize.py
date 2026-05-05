"""Auto-fix optimizer — week 3 implementation.

Given a failure cluster's training examples (input, expected, actual), use
DSPy to synthesize a targeted prompt + few-shot patch that should help on
that cluster without breaking other passing cases.

Strategy progression:
  - First round: BootstrapFewShot — selects strong examples from the
    training pool. Highest ROI for the least cost.
  - Second+ rounds (handled by caller): MIPROv2 — multi-instruction proposal.
    Rewrites instructions and few-shots together. ~10x more expensive but
    catches cases BootstrapFewShot can't fix with just examples.
  - GEPA (reflective evolution) — week 4+. Most powerful, slowest.

Output is a structured Patch:
  - prompt_diff: text to APPEND to the system prompt (additive only)
  - few_shots: list of (input, output) pairs to include
  - expected_lift: optimizer's confidence in the patch (0..1, optional)

Why we ALWAYS additive: customers may already have a careful system prompt.
We never overwrite it — we extend with cluster-targeted addenda. If they
want destructive patches, that's a v2 setting.
"""

from __future__ import annotations

import os
from typing import Literal

from openai import OpenAI
from pydantic import BaseModel, Field

# DSPy is heavy + has its own LM-config dance — defer import.
def _dspy():
    import dspy  # type: ignore
    return dspy


# ---------- types ----------


class TrainExample(BaseModel):
    input: str
    expected: str
    actual: str = ""  # what the SUT produced (the failure)


class OptimizeRequest(BaseModel):
    cluster_label: str
    cluster_summary: str
    current_system_prompt: str = ""
    train_examples: list[TrainExample] = Field(..., min_length=1)
    method: Literal["bootstrap_few_shot", "mipro_v2", "gepa"] = "bootstrap_few_shot"
    judge_model: str = Field(
        default_factory=lambda: os.getenv("JUDGE_MODEL", "gpt-4o")
    )


class OptimizeResponse(BaseModel):
    prompt_diff: str
    few_shots: list[dict[str, str]] = Field(default_factory=list)
    expected_lift: float | None = None
    method_used: str
    notes: str = ""


# ---------- public entry ----------


async def optimize(req: OptimizeRequest) -> OptimizeResponse:
    """
    Top-level entry. Routes to the requested method, falling back to a
    naive LLM-based proposer if DSPy isn't available or fails.
    """
    try:
        if req.method == "bootstrap_few_shot":
            return await _bootstrap_few_shot(req)
        if req.method == "mipro_v2":
            return await _mipro_v2(req)
        # GEPA / unknown → fall through to naive
    except Exception as e:
        return await _naive_propose(req, fallback_reason=f"DSPy failed: {e}")

    return await _naive_propose(req, fallback_reason="Unknown method")


# ---------- BootstrapFewShot via DSPy ----------


async def _bootstrap_few_shot(req: OptimizeRequest) -> OptimizeResponse:
    """
    DSPy's BootstrapFewShot picks the most informative examples from the
    training pool by running the model and keeping ones that succeed. We
    trim our pool to those that have the strongest "this is what the right
    answer looks like" signal: where actual ≠ expected (so the failure is
    informative) and expected is non-trivial.
    """
    dspy = _dspy()
    dspy.settings.configure(lm=dspy.LM(req.judge_model))

    # Define a tiny DSPy program that takes input → answer.
    # The optimizer adapts THIS program; we inspect what it bootstrapped.
    class CaseAnswerer(dspy.Signature):
        """Answer the input question correctly given the cluster context."""
        input_text: str = dspy.InputField(desc="The user input")
        answer: str = dspy.OutputField(desc="The correct answer")

    program = dspy.Predict(CaseAnswerer)

    train_set = [
        dspy.Example(input_text=ex.input, answer=ex.expected).with_inputs("input_text")
        for ex in req.train_examples
    ]

    def _metric(example, pred, trace=None) -> float:
        # Crude string-similarity gate. DSPy will boostrap any example whose
        # bootstrap-pred is reasonably close to the gold. Good enough for
        # selection; the actual judge runs on the full eval downstream.
        if not pred or not getattr(pred, "answer", ""):
            return 0.0
        return _string_overlap(example.answer, pred.answer)

    optimizer = dspy.teleprompt.BootstrapFewShot(metric=_metric, max_bootstrapped_demos=4)
    try:
        compiled = optimizer.compile(program, trainset=train_set)
    except Exception as e:
        return await _naive_propose(req, fallback_reason=f"Bootstrap failed: {e}")

    # Extract the bootstrapped few-shots from the compiled program.
    demos = []
    try:
        for d in compiled.demos:  # type: ignore[attr-defined]
            inp = getattr(d, "input_text", None) or d.get("input_text", "")
            out = getattr(d, "answer", None) or d.get("answer", "")
            if inp and out:
                demos.append({"input": str(inp), "output": str(out)})
    except Exception:
        pass

    if not demos:
        return await _naive_propose(req, fallback_reason="No demos bootstrapped")

    prompt_diff = (
        f"\n## Pattern: {req.cluster_label}\n"
        f"{req.cluster_summary}\n"
        f"When you encounter inputs like the examples below, follow the same pattern."
    )
    return OptimizeResponse(
        prompt_diff=prompt_diff,
        few_shots=demos[:4],
        expected_lift=None,
        method_used="bootstrap_few_shot",
        notes=f"Bootstrapped {len(demos)} demos.",
    )


# ---------- MIPROv2 via DSPy ----------


async def _mipro_v2(req: OptimizeRequest) -> OptimizeResponse:
    """
    MIPROv2 jointly optimizes instructions + few-shots. Significantly more
    expensive than BootstrapFewShot (typically 30-100 LM calls vs 5-10).
    Use after BootstrapFewShot has plateaued.

    Implementation: same skeleton as bootstrap; we just swap the optimizer.
    """
    dspy = _dspy()
    dspy.settings.configure(lm=dspy.LM(req.judge_model))

    class CaseAnswerer(dspy.Signature):
        """Answer the input question correctly."""
        input_text: str = dspy.InputField(desc="The user input")
        answer: str = dspy.OutputField(desc="The correct answer")

    program = dspy.Predict(CaseAnswerer)
    train_set = [
        dspy.Example(input_text=ex.input, answer=ex.expected).with_inputs("input_text")
        for ex in req.train_examples
    ]

    def _metric(example, pred, trace=None) -> float:
        if not pred or not getattr(pred, "answer", ""):
            return 0.0
        return _string_overlap(example.answer, pred.answer)

    try:
        optimizer = dspy.teleprompt.MIPROv2(
            metric=_metric,
            num_candidates=5,
            init_temperature=1.0,
        )
        compiled = optimizer.compile(
            program,
            trainset=train_set,
            num_trials=10,
            requires_permission_to_run=False,
        )
    except Exception as e:
        # MIPROv2 has a bunch of failure modes — fall back to bootstrap.
        return await _bootstrap_few_shot(req)

    # Extract instruction + demos
    instruction = ""
    try:
        for sig_name, sig in compiled.named_predictors():  # type: ignore
            instruction = sig.signature.__doc__ or ""
            break
    except Exception:
        pass

    demos = []
    try:
        for d in compiled.demos:  # type: ignore[attr-defined]
            inp = getattr(d, "input_text", "")
            out = getattr(d, "answer", "")
            if inp and out:
                demos.append({"input": str(inp), "output": str(out)})
    except Exception:
        pass

    prompt_diff = f"\n## Pattern: {req.cluster_label}\n{instruction or req.cluster_summary}\n"
    return OptimizeResponse(
        prompt_diff=prompt_diff,
        few_shots=demos[:4],
        expected_lift=None,
        method_used="mipro_v2",
        notes="MIPROv2 jointly optimized instruction + few-shots.",
    )


# ---------- Naive LLM proposer (fallback when DSPy is unavailable) ----------


_oai_client: OpenAI | None = None


def _client() -> OpenAI:
    global _oai_client
    if _oai_client is None:
        _oai_client = OpenAI()
    return _oai_client


async def _naive_propose(req: OptimizeRequest, fallback_reason: str = "") -> OptimizeResponse:
    """
    Plain-LLM proposer. Robust; minimal lift compared to DSPy methods but
    always works as long as the judge model is reachable.

    We ask the LLM to produce both an instruction snippet AND 2-3 few-shot
    examples. Then we structure the response as a Patch.
    """
    examples_text = "\n\n".join(
        f"--- Failed example ---\nInput: {ex.input}\nExpected: {ex.expected}\nActual: {ex.actual}"
        for ex in req.train_examples[:5]
    )

    user_prompt = f"""You are a senior prompt engineer. Below are AI eval failures that share a common pattern:

CLUSTER LABEL: {req.cluster_label}
PATTERN: {req.cluster_summary}

{examples_text}

Current system prompt:
\"\"\"
{req.current_system_prompt or '(empty — no current system prompt)'}
\"\"\"

Propose a SHORT additive patch (an instruction snippet + 2-3 few-shot examples) that
will help the AI handle this pattern correctly WITHOUT breaking other inputs.

Return JSON in this exact shape (no markdown):
{{
  "prompt_diff": "<2-4 sentence instruction to APPEND to the system prompt>",
  "few_shots": [
    {{"input": "<example input>", "output": "<correct answer>"}},
    ...up to 3
  ],
  "expected_lift": <float 0..1 or null>
}}

Rules:
- Keep prompt_diff concise (max 80 words). Long prompts hurt the optimizer.
- Few-shots must be DIFFERENT from the failed examples — synthesize new
  examples that exercise the same pattern correctly.
- Never propose anything that contradicts the current system prompt.
"""

    resp = _client().chat.completions.create(
        model=req.judge_model,
        messages=[{"role": "user", "content": user_prompt}],
        response_format={"type": "json_object"},
        temperature=0.4,
    )
    raw = resp.choices[0].message.content or "{}"

    import json

    try:
        parsed = json.loads(raw)
    except json.JSONDecodeError:
        return OptimizeResponse(
            prompt_diff="",
            few_shots=[],
            expected_lift=None,
            method_used="naive_llm",
            notes=f"JSON parse failed. Fallback: {fallback_reason}",
        )

    raw_shots = parsed.get("few_shots") or []
    few_shots = []
    for s in raw_shots:
        if isinstance(s, dict) and s.get("input") and s.get("output"):
            few_shots.append({"input": str(s["input"]), "output": str(s["output"])})

    return OptimizeResponse(
        prompt_diff=str(parsed.get("prompt_diff", "")),
        few_shots=few_shots[:3],
        expected_lift=parsed.get("expected_lift"),
        method_used="naive_llm",
        notes=f"Used naive LLM proposer. Reason: {fallback_reason}".strip(),
    )


# ---------- helpers ----------


def _string_overlap(a: str, b: str) -> float:
    """Crude token-overlap score. 0..1. Used only by DSPy's metric in
    bootstrap selection — not for final scoring (DeepEval handles that)."""
    aw = set(a.lower().split())
    bw = set(b.lower().split())
    if not aw or not bw:
        return 0.0
    return len(aw & bw) / max(len(aw | bw), 1)
