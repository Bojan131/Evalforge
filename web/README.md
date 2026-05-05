# EvalForge — web

Next.js 15 dashboard + Mastra orchestration layer.

```
app/
  page.tsx              Landing page
  layout.tsx            Root layout (fonts, dark theme)
  runs/
    page.tsx            List of past runs
    new/page.tsx        Submission form (the centerpiece)
    [id]/page.tsx       Per-run results + status
  settings/page.tsx     Settings stub
  api/
    runs/route.ts       POST = start run, GET = list
    runs/[id]/route.ts  GET single run state

components/ui/          shadcn-style primitives (button, input, card, score-chip, …)
lib/
  types/eval.ts         Zod schemas — kept in sync with deepeval-svc/app/types.py
  utils.ts              cn(), scoreToken(), pct(), shortId()
  run-store.ts          In-memory run store (Postgres in week 5)

mastra/
  index.ts              Mastra instance (workflows + agents)
  workflows/
    eval-run.ts         Score → cluster → propose → re-score → loop
  agents/
    judge.ts            Meta-judge for sanity checks
    cluster-summarizer.ts  Names failure modes (week 2)
    patch-proposer.ts   Drives DSPy (week 3)
  tools/
    call-deepeval.ts    Bridge to the Python sidecar
```

## Run

```bash
pnpm install
cp ../.env.example .env.local   # fill in OPENAI_API_KEY at minimum
pnpm dev
```

App boots at `http://localhost:3000`. The DeepEval Python sidecar must be
running at `http://localhost:8787` — start it with:

```bash
cd ../deepeval-svc
uvicorn app.main:app --reload --port 8787
```

If the sidecar is down, `POST /api/runs` returns a 503 with a clear hint.

## Notes

- Tailwind v4 with `@theme inline` mapping our CSS variables to color tokens.
- Default dark theme — light theme tokens exist but no toggle yet.
- All score colours come from `--score-*` tokens; never hardcoded.
- Mastra runs in-process (Node side of Next.js). Workflow execution is fire-
  and-forget per-request; UI polls `/api/runs/:id` for state.
