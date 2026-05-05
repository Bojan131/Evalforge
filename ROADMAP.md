# EvalForge — Roadmap

Honest build plan. What's done, what's next, what's NOT in scope.

---

## Status: weeks 1-3 wired end-to-end

This is the "you can fire it up and watch the loop run" milestone. All four
phases of the closed-loop pipeline have working implementations. They're not
production-tuned, but they execute and produce real output.

### ✅ Done (current commit)

**Foundation**
- Next.js 15 dashboard (landing, eval form, runs list, results detail, settings)
- Design system ported from SentinelQA — warm-dark Linear skin, Instrument
  Serif headings, Inter body, JetBrains Mono. Score-chip token ramp.
- Component primitives: Button, Card, Input, Textarea, ScoreChip
- Zod types in `web/lib/types/eval.ts` mirror Python's pydantic types 1:1
- TypeScript strict mode passes (`pnpm typecheck`)
- Next.js production build passes (`pnpm build`) — all 8 routes compile

**DeepEval scoring** (week 1, real)
- FastAPI sidecar with `/health`, `/score`, `/score/single`
- DeepEval GEval rubric judge — correctness, completeness, hallucination, format
- Parallel SUT calls bounded by `max_concurrency`
- Tolerant SUT response parser (OpenAI shape + 5 fallbacks + str() last resort)

**Failure clustering** (week 2, real)
- `/cluster` endpoint
- OpenAI text-embedding-3-large per failed (input, expected, actual, reasoning)
- Cosine-normalized → HDBSCAN with EOM cluster selection
- Noise points bucketed into a fallback cluster (never dropped)
- Each cluster summarized by an LLM with strict JSON output: `{label, summary}`

**Auto-fix optimizer** (week 3, real)
- `/optimize` endpoint
- DSPy `BootstrapFewShot` for round 1 (cheap, high-ROI)
- DSPy `MIPROv2` for round 2+ (instructions + few-shots, more expensive)
- Naive LLM proposer as universal fallback (works even if DSPy import fails)
- Strict additive patches — never overwrites the customer's system prompt
- Output Patch: `{ prompt_diff, few_shots[], expected_lift }`

**Closed loop orchestration** (week 4 partial, real)
- `web/mastra/workflows/eval-run.ts` plain-TS pipeline
- Score → cluster → propose → re-score → regression-guard → loop
- **Train/test split** built in (default 70/30, deterministic)
- **Regression guard** — patch rejected if any previously-passing case fails
- **Stop conditions** — goal score / 5 rounds / 3 rejected patches in a row / budget cap
- Streaming sink callback so UI sees state updates per step
- Patch audit trail per round: `{ round, prompt_diff, few_shots, applied, accepted, reject_reason, test_score_before, test_score_after }`

### 🟡 Stubbed / coming next

- **Spend tracking** — pipeline tracks `spent_usd: 0` but doesn't yet wire to
  actual judge + optimizer cost telemetry. Patch in week 4.5.
- **System-prompt injection mechanism** — currently sends the patched prompt
  via an `X-EvalForge-System-Prompt` header. Most SUTs will ignore that.
  Real implementation should send it as a `system` message in the OpenAI
  payload. Trivial fix; doing it next.
- **Synthetic eval expansion** (anti-overfit) — DeepEval's `Synthesizer`
  isn't wired in yet. Week 4 adds it before the train/test split.
- **Multi-judge consensus** — single rubric judge for now. Add when we have
  customer accuracy complaints.

---

## Week 4 — Polish + UX

- [ ] Wire spent_usd to real cost (count judge + DSPy LM calls, multiply by
  per-million pricing for the configured model)
- [ ] Send patched prompt as a system message, not a header. Inject correctly.
- [ ] DeepEval Synthesizer to expand 20→60 cases (paraphrases, edge cases)
  before optimization, score on original 20
- [ ] Round-by-round timeline UI on `/runs/:id` — every patch attempt with
  before/after diff side-by-side, accept/reject reason
- [ ] CSV export of full audit trail
- [ ] "Test against my AI" button on the form (uses `/score/single`) so
  customers can sanity-check connectivity

**Acceptance:** End-to-end demo — paste OpenAI endpoint, submit 25
questions, walk away, return to a 60→95% trajectory with 4 rounds of patches
in the audit log.

---

## Week 5+ — Productization

- [ ] Postgres schema + Supabase migrations (eval_run, eval_case, score, cluster, patch_attempt)
- [ ] Auth (Supabase, magic-link)
- [ ] Multi-tenant isolation
- [ ] Per-org rate limits + usage metering
- [ ] Stripe integration
- [ ] Public landing page

---

## Out of scope (intentional)

- ❌ **Fine-tuning model weights.** Prompts + few-shots + retrieval config only.
- ❌ **Building our own metrics.** DeepEval has 50+. We extend, never reinvent.
- ❌ **Replacing observability tools.** We integrate with Braintrust/Langfuse/Phoenix
  if a customer uses one. We don't compete.
- ❌ **AFlow / agentic-workflow optimization.** v2 differentiator.
- ❌ **Multi-judge CourtEval.** Add when accuracy demands it.

---

## How to run

```bash
# Terminal A — Python sidecar
cd deepeval-svc
source .venv/bin/activate
export OPENAI_API_KEY=sk-...        # judge model auth
export JUDGE_MODEL=gpt-4o
uvicorn app.main:app --reload --port 8787

# Terminal B — Next.js + Mastra
cd web
cp ../.env.example .env.local       # fill OPENAI_API_KEY here too
pnpm dev
```

Open `http://localhost:3000` → "Start a new eval run" → paste your AI's
chat-completions endpoint URL + key + 3-30 questions → watch the loop run.

---

## Anti-goals (refuse to ship even if asked)

- Auto-deploying patches to production without human approval
- Sharing one customer's eval set with another customer's optimizer
- Allowing a customer's prompt to leak into our training data
- Calling a customer's AI without a clear cost cap
