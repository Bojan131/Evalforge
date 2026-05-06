# EvalForge

**Closed-loop AI evals.** Score your AI, diagnose failures, auto-fix until 95%.

> Most eval tools (Ragas, DeepEval, Promptfoo, Braintrust, LangSmith) give you a number and stop. EvalForge closes the loop: it identifies *why* your AI failed on the 27% it got wrong, proposes prompt + few-shot patches that target those specific failure modes, applies them, re-scores against held-out cases, and iterates until your AI hits 95%+ — or until it hits a budget cap and tells you why it can't get further.

---

## The product in one sentence

> _"Your AI scored 73%. Wake up tomorrow at 95%."_

---

## How it works

```
┌──────────────────┐
│ 1. Submit eval   │  Form: 20+ question/expected/context rows
│    set + AI URL  │  Or upload CSV, or paste JSON
└────────┬─────────┘
         │
┌────────▼─────────┐
│ 2. Score         │  DeepEval rubric judge (correctness, completeness,
│                  │  hallucination, format) on customer's AI output
└────────┬─────────┘
         │  → 73% overall, 27% failed
┌────────▼─────────┐
│ 3. Cluster       │  Embed failures, HDBSCAN, LLM-summarize each cluster
│    failures      │  → "8 cases failed on date arithmetic"
└────────┬─────────┘
         │
┌────────▼─────────┐
│ 4. Propose patch │  DSPy (BootstrapFewShot → MIPROv2 → GEPA)
│                  │  proposes targeted prompt + few-shot edits
└────────┬─────────┘
         │
┌────────▼─────────┐
│ 5. Re-score      │  Apply patch, re-run evals on FULL set
│    + regression  │  Reject if any previously-passing case now fails
│    guard         │
└────────┬─────────┘
         │
         └──── loop until ≥95% on held-out test set,
              5 rounds without lift, OR budget cap hit
```

---

## Stack

| Layer | Choice | Why |
|---|---|---|
| Frontend | Next.js 16 + Tailwind v4 + shadcn-style components | Same look & feel as the SentinelQA dashboard (warm-dark Linear skin) |
| Orchestration | [Mastra](https://mastra.ai) (TypeScript) | Workflows, agents, memory, telemetry — all built in |
| LLM SDK | Vercel AI SDK v6 | Underneath Mastra; multi-provider |
| Eval scoring | [DeepEval](https://deepeval.com) (Python sidecar) | 50+ metrics, GEval rubric judge, agent-trace eval |
| Failure clustering | OpenAI embeddings + HDBSCAN + LLM summarizer | Custom — none of the off-the-shelf tools cluster well |
| Auto-fix optimizer | [DSPy](https://dspy.ai) (Python sidecar) | BootstrapFewShot, MIPROv2, GEPA. Reference framework. |
| Storage | Postgres + Supabase Storage | Eval runs, scores, patches, traces |
| Auth | Supabase Auth (later) | — |

---

## Repo layout

```
evalforge/
├── web/                Next.js 16 — UI + Mastra orchestration
│   ├── app/            App Router pages (dashboard, eval form, results)
│   ├── components/     UI primitives (shadcn-style, ported from SentinelQA)
│   ├── lib/            Shared client utilities + types
│   └── mastra/         Workflow, agents, tools
│       ├── workflows/  evalRun: score → cluster → propose → re-score → loop
│       ├── agents/     judge, clusterSummarizer, patchProposer
│       └── tools/      callDeepEval, callDspy, callSut (system-under-test)
│
├── deepeval-svc/       Python FastAPI sidecar
│   ├── app/
│   │   ├── main.py     FastAPI entrypoint
│   │   ├── score.py    DeepEval GEval scoring
│   │   └── synth.py    Synthetic eval expansion (anti-overfit)
│   ├── pyproject.toml
│   └── README.md
│
├── docs/               Design notes, ADRs
├── README.md           This file
├── ROADMAP.md          Week-by-week build plan
└── .env.example        Required env vars
```

---

## Run locally

You need: Node 20+, pnpm, Python 3.11+, an OpenAI API key (for the judge model — different from the system-under-test).

```bash
# 1. Python sidecar (terminal A)
cd deepeval-svc
python -m venv .venv && source .venv/bin/activate
pip install -e .
uvicorn app.main:app --reload --port 8787

# 2. Next.js + Mastra (terminal B)
cd web
pnpm install
cp ../.env.example .env.local
# fill in OPENAI_API_KEY (judge), DEEPEVAL_URL=http://localhost:8787
pnpm dev
```

Open `http://localhost:3000` and submit your first eval set.

---

## Design philosophy

1. **Closed loop is the differentiator.** Every other tool stops at "score". We continue.
2. **Hill-climbing is the failure mode.** We split train/dev/test on the user's cases, regression-guard every patch, and synthetically expand the eval set so the optimizer can't memorize.
3. **Don't write our own metrics.** DeepEval has 50+. Use them. Our value is the loop, not metric inventions.
4. **Don't fine-tune weights.** Prompts + few-shots + retrieval config only. Keeps the product reversible, model-agnostic, and safe.
5. **The customer's AI stays a black box.** They paste an OpenAI-compatible endpoint URL + key; we call it, we never see weights.

---
