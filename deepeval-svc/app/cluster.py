"""Failure clustering — week 2 implementation.

Take a batch of failed cases (question, expected, actual, judge reasoning),
embed them, HDBSCAN cluster, then ask an LLM to name each cluster.

Why HDBSCAN (not k-means):
  - We don't know how many clusters there are upfront
  - HDBSCAN handles noise points (failures that don't fit a pattern)
  - Density-based — natural for embeddings

Strategy for embedding:
  - Concatenate (question, expected, actual, judge_reasoning) into one
    string per case so the embedding captures BOTH the input space and the
    failure mode. Failures that share an INPUT pattern but different failure
    modes will land in different clusters; that's the right behaviour.
"""

from __future__ import annotations

import os
from typing import Any

from openai import OpenAI
from pydantic import BaseModel, Field

# Lazy imports to keep startup fast when the service is only being asked /health
def _hdbscan():
    import hdbscan  # type: ignore
    return hdbscan


def _np():
    import numpy as np
    return np


# ---------- types ----------


class FailureTriple(BaseModel):
    id: str
    question: str
    expected: str
    actual: str
    reasoning: str = ""


class Cluster(BaseModel):
    id: str
    label: str
    summary: str
    case_ids: list[str]
    size: int


class ClusterRequest(BaseModel):
    triples: list[FailureTriple]
    min_cluster_size: int = Field(default=2, ge=2, le=10)
    embedding_model: str = Field(
        default_factory=lambda: os.getenv("EMBEDDING_MODEL", "text-embedding-3-large")
    )


class ClusterResponse(BaseModel):
    clusters: list[Cluster]
    embedded_count: int
    noise_count: int


# ---------- embed + cluster ----------

_oai_client: OpenAI | None = None


def _client() -> OpenAI:
    global _oai_client
    if _oai_client is None:
        _oai_client = OpenAI()
    return _oai_client


def _embed_text(t: FailureTriple) -> str:
    # Order matters: input first, then expected, then actual, then reasoning.
    # Embeddings tend to weight earlier tokens slightly higher.
    return (
        f"INPUT: {t.question}\n\n"
        f"EXPECTED: {t.expected}\n\n"
        f"ACTUAL: {t.actual}\n\n"
        f"REASON: {t.reasoning}"
    )


async def cluster_failures(req: ClusterRequest) -> ClusterResponse:
    if len(req.triples) < req.min_cluster_size:
        # Not enough points to cluster — return a single bucket
        return ClusterResponse(
            clusters=[
                Cluster(
                    id="cluster_single_0",
                    label="all-failures",
                    summary="Too few failures to cluster meaningfully.",
                    case_ids=[t.id for t in req.triples],
                    size=len(req.triples),
                )
            ]
            if req.triples
            else [],
            embedded_count=len(req.triples),
            noise_count=0,
        )

    np = _np()
    hdbscan = _hdbscan()

    # ---- embed ----
    texts = [_embed_text(t) for t in req.triples]
    embeddings_resp = _client().embeddings.create(
        model=req.embedding_model, input=texts
    )
    vectors = np.array([d.embedding for d in embeddings_resp.data], dtype=np.float32)

    # Normalize so cosine == euclidean (HDBSCAN works with euclidean by default).
    norms = np.linalg.norm(vectors, axis=1, keepdims=True)
    norms[norms == 0] = 1.0
    vectors = vectors / norms

    # ---- cluster ----
    clusterer = hdbscan.HDBSCAN(
        min_cluster_size=req.min_cluster_size,
        metric="euclidean",
        cluster_selection_method="eom",
    )
    labels = clusterer.fit_predict(vectors)

    # Group case IDs by cluster label (-1 = noise)
    grouped: dict[int, list[int]] = {}
    for idx, lbl in enumerate(labels):
        grouped.setdefault(int(lbl), []).append(idx)

    noise_indices = grouped.pop(-1, [])
    # Stuff every noise case into a single fallback cluster — better than
    # dropping them entirely. The optimizer can still target it.
    if noise_indices:
        grouped[-2] = noise_indices  # use -2 as a synthetic key

    # ---- summarise each cluster with an LLM ----
    clusters: list[Cluster] = []
    for lbl, indices in sorted(grouped.items(), key=lambda x: -len(x[1])):
        members = [req.triples[i] for i in indices]
        summary = await _summarise(members)
        clusters.append(
            Cluster(
                id=f"cluster_{lbl}_{len(clusters)}",
                label=summary["label"],
                summary=summary["summary"],
                case_ids=[m.id for m in members],
                size=len(members),
            )
        )

    return ClusterResponse(
        clusters=clusters,
        embedded_count=len(req.triples),
        noise_count=len(noise_indices),
    )


# ---------- LLM cluster naming ----------


async def _summarise(members: list[FailureTriple]) -> dict[str, str]:
    """Ask the judge model to name the cluster's failure pattern in plain English."""
    sample = members[: min(6, len(members))]  # cap so context fits
    examples = "\n\n".join(
        f"--- Case {m.id} ---\nQ: {m.question}\nExpected: {m.expected}\nActual: {m.actual}\nReason: {m.reasoning}"
        for m in sample
    )

    judge_model = os.getenv("JUDGE_MODEL", "gpt-4o")
    prompt = (
        "You are reviewing a cluster of failed AI eval cases that share something in common. "
        "Identify the SHARED failure pattern in plain English.\n\n"
        f"{examples}\n\n"
        "Return EXACTLY this JSON shape (no markdown fences):\n"
        '{"label": "<3-5 word label>", "summary": "<1-2 sentence root cause>"}'
    )

    resp = _client().chat.completions.create(
        model=judge_model,
        messages=[{"role": "user", "content": prompt}],
        response_format={"type": "json_object"},
        temperature=0.2,
    )
    raw = resp.choices[0].message.content or "{}"
    import json

    try:
        parsed = json.loads(raw)
        return {
            "label": str(parsed.get("label", "unlabelled"))[:60],
            "summary": str(parsed.get("summary", "")),
        }
    except json.JSONDecodeError:
        return {"label": "unlabelled", "summary": raw[:200]}
