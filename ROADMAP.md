# EvalForge — Roadmap

Honest build plan. What's done, what's next, what's NOT in scope.

---

## Week 1 — Foundation (this commit)

✅ **Done:**
- Repo scaffolded (`web/` Next.js + Mastra, `deepeval-svc/` Python sidecar)
- Design system ported from SentinelQA (warm-dark Linear skin, Instrument Serif headings, Inter body, the same component primitives)
- Eval submission form: 20+ rows of `{question, expected, context, weight, category}` with CSV import
- DeepEval Python sidecar with `POST /score` endpoint — rubric-based GEval judge (correctness/completeness/hallucination/format)
- Mastra workflow skeleton (`evalRun`) with one live step (`score`) and four typed-but-stubbed steps
- Results page showing per-question scores + overall %
- API route `/api/runs` that triggers the workflow

🟡 **Stubbed but typed (so weeks 2-4 slot in cleanly):**
- Failure clustering step — returns dummy clusters
- Patch proposer step — returns "no-op" patch
- Re-score + regression guard — calls score again with same input
- Loop controller — single round only

---

## Week 2 — Failure analysis

- [ ] Embed every failed `(question, expected, actual)` triple via OpenAI `text-embedding-3-large`
- [ ] HDBSCAN cluster on embeddings (Python sidecar with `POST /cluster`)
- [ ] LLM-summarize each cluster with a strict rubric: "What pattern of input causes failure here?"
- [ ] Cluster results displayed in dashboard with sample cases per cluster
- [ ] Train/dev/test split on user's eval set (60/20/20) — built into `/api/runs`

**Acceptance:** Submit 30 questions where 10 fail on dates and 5 fail on rate-limit edge cases. Cluster output shows 2 distinct clusters with correct summaries.

---

## Week 3 — Auto-fix optimizer

- [ ] DSPy Python sidecar service (`POST /optimize`)
- [ ] BootstrapFewShot integration first (highest ROI, ~1 day to wire)
- [ ] MIPROv2 integration second (multi-instruction proposal)
- [ ] Patch diff format: `{ promptDiff: string, fewShotsAdded: Example[], modelHint?: string }`
- [ ] Mastra agent `patchProposer` that calls DSPy with the failure clusters as input
- [ ] Cost cap per run (default $5, user-configurable up to $50)

**Acceptance:** A real eval set scoring 60% on customer's AI lifts to 80%+ after one round, dev set holds.

---

## Week 4 — Closed loop + UX polish

- [ ] Apply patch step (`POST /score` again with the patched prompt as system instruction)
- [ ] Regression guard: reject if ANY previously-passing case now fails
- [ ] Loop controller: stop at ≥95% test score, OR 5 rounds without lift, OR budget cap
- [ ] Audit log per run: every patch attempt with diff + lift + accept/reject reason
- [ ] Dashboard: round-by-round timeline, before/after diff view (side-by-side), per-cluster lift breakdown
- [ ] CSV export of full audit trail (compliance-friendly)

**Acceptance:** End-to-end demo: paste a customer endpoint, submit 25 questions, walk away, return to a 60→95% trajectory with 4 rounds of patches in the audit log.

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

- ❌ **Fine-tuning model weights.** Prompts + few-shots + retrieval config only. Reversible, safe, model-agnostic.
- ❌ **Building our own metrics.** DeepEval has 50+. We extend, never reinvent.
- ❌ **Replacing observability tools.** We integrate with Braintrust/Langfuse/Phoenix if customer uses one. We don't compete.
- ❌ **AFlow / agentic-workflow optimization.** Future v2 differentiator if customers ask for it. Not in MVP.
- ❌ **Multi-judge consensus (CourtEval).** Single rubric judge for MVP. Add when accuracy demands it.

---

## What's the moat

1. **Closed loop.** Every competitor stops at score. We finish the job.
2. **Failure clustering with diagnosis.** Nobody does this well today.
3. **Regression-guarded auto-fix.** The hard problem is "improve without breaking". Most academic papers ignore it; we make it the default.
4. **Audit trail per change.** "Round 3 added 2 few-shot examples about date handling. Lift: +6pp on test set." Compliance loves this.

---

## Anti-goals (things we'd refuse to ship even if asked)

- Auto-deploying patches to production without human approval
- Sharing one customer's eval set with another customer's optimizer
- Allowing a customer's prompt to leak into our model's training data
- Calling a customer's AI without a clear cost cap
