# EvalForge — DeepEval Sidecar

Python service that wraps DeepEval's GEval rubric judge and exposes it as an
HTTP API the Mastra orchestrator can call.

## Why a sidecar (not a port to TS)

- DeepEval is Python-only. Maintained by the Confident AI team. Reimplementing
  in TS would mean re-deriving 50+ metrics. Bad idea.
- The Node side never has to spawn Python. Cleaner deploy story (Docker-friendly).
- Sidecar can scale independently of the web tier.

## Run

```bash
python -m venv .venv
source .venv/bin/activate
pip install -e .
cp ../.env.example ../.env  # we don't read this directly — the web side does;
                             # but JUDGE_MODEL/OPENAI_API_KEY can also be exported here
export OPENAI_API_KEY=sk-...
export JUDGE_MODEL=gpt-4o
uvicorn app.main:app --reload --port 8787
```

Verify:

```bash
curl http://localhost:8787/health
# {"status":"ok","judge_model":"gpt-4o","judge_provider":"openai","version":"0.1.0"}
```

## Endpoints

| Method | Path           | Purpose                                    |
|--------|----------------|--------------------------------------------|
| GET    | /health        | Liveness probe                             |
| POST   | /score         | Score a full eval set (batch, parallel)    |
| POST   | /score/single  | Score one case (form preview / sanity check)|

See `app/types.py` for request / response shapes. They mirror
`web/lib/types/eval.ts` 1:1 — keep them in sync.

## Notes

- We use **GEval** for all four sub-metrics (correctness, completeness,
  hallucination, format) because GEval handles rubric criteria + chain-of-
  thought reasoning natively. Other DeepEval metrics (faithfulness, toxicity,
  bias) can slot in next to GEval as the rubric grows.
- The composite score is a **weighted average** of sub-scores per the rubric
  the customer supplied. Default weights are in `Rubric` defaults in `types.py`.
- `max_concurrency` defaults to 8 — keeps judge-model rate limits manageable
  on a 100-case batch. Tune in the request payload.
