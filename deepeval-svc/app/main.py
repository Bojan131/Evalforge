"""
EvalForge — DeepEval scoring sidecar.

Single responsibility: take a customer's eval set + a system-under-test (SUT)
endpoint, call the SUT for each case, score every (input, expected, actual)
triple via DeepEval's GEval rubric judge, and return per-case + overall scores.

The Mastra workflow on the Node side calls this service over HTTP. We keep
DeepEval (Python-only) inside this sidecar so the Node orchestrator never has
to fight Python interop.

Routes
------
GET  /health        — liveness probe
POST /score         — score a batch of cases against a SUT endpoint
POST /score/single  — score one case (used by the Next.js form preview)
"""

from __future__ import annotations

import os
from contextlib import asynccontextmanager
from typing import Any

from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware

from app.score import score_batch, score_one
from app.cluster import ClusterRequest, ClusterResponse, cluster_failures
from app.optimize import OptimizeRequest, OptimizeResponse, optimize
from app.types import (
    HealthResponse,
    ScoreBatchRequest,
    ScoreBatchResponse,
    ScoreSingleRequest,
    ScoreSingleResponse,
)

load_dotenv()


@asynccontextmanager
async def lifespan(_: FastAPI):
    # Could pre-load judge model client here. Kept minimal for week 1.
    yield


app = FastAPI(
    title="EvalForge — DeepEval Sidecar",
    version="0.1.0",
    description="Rubric-based scoring service. Called by the Mastra orchestrator.",
    lifespan=lifespan,
)

# Mastra runs on localhost during dev; lock down in production.
app.add_middleware(
    CORSMiddleware,
    allow_origins=os.getenv("CORS_ORIGINS", "http://localhost:3000").split(","),
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
)


@app.get("/health", response_model=HealthResponse)
async def health() -> HealthResponse:
    return HealthResponse(
        status="ok",
        judge_model=os.getenv("JUDGE_MODEL", "gpt-4o"),
        judge_provider=os.getenv("JUDGE_PROVIDER", "openai"),
        version=app.version,
    )


@app.post("/score", response_model=ScoreBatchResponse)
async def score(req: ScoreBatchRequest) -> ScoreBatchResponse:
    """
    Score a full eval set. Concurrency: cases are scored in parallel up to
    `max_concurrency` to keep latency bounded for 20-100 case batches.
    """
    try:
        return await score_batch(req)
    except Exception as e:  # broad — surface message to orchestrator
        raise HTTPException(status_code=500, detail=str(e)) from e


@app.post("/score/single", response_model=ScoreSingleResponse)
async def score_single(req: ScoreSingleRequest) -> ScoreSingleResponse:
    """
    Score one case — used by the form preview "test against my AI" button so
    the user can sanity-check connectivity before committing to a full run.
    """
    try:
        return await score_one(req)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e)) from e


@app.post("/cluster", response_model=ClusterResponse)
async def cluster(req: ClusterRequest) -> ClusterResponse:
    """
    Cluster a set of failed cases by embedding similarity, then ask the
    judge model to name each cluster's pattern. Returns clusters with
    case_id lists so the orchestrator can route patches to specific clusters.
    """
    try:
        return await cluster_failures(req)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"clustering failed: {e}") from e


@app.post("/optimize", response_model=OptimizeResponse)
async def optimize_endpoint(req: OptimizeRequest) -> OptimizeResponse:
    """
    Run the auto-fix optimizer (DSPy BootstrapFewShot / MIPROv2 / GEPA, or
    a naive LLM fallback). Returns a Patch — system-prompt addendum + few-
    shot examples — that targets the named cluster's failure pattern.

    This endpoint is the heart of the "auto-fix" loop. Cost: 5-100 LM calls
    depending on `method`. Caller should set a budget cap.
    """
    try:
        return await optimize(req)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"optimization failed: {e}") from e
