'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Plus, Trash2, Upload, Sparkles, ArrowLeft, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { shortId } from '@/lib/utils';
import type { EvalCase, EvalCategory } from '@/lib/types/eval';

/**
 * Eval submission form.
 *
 * UX rules borrowed from the SentinelQA dashboard:
 *   - Dense table-like row layout, not over-padded
 *   - Inline add/remove, never hidden behind "expand"
 *   - "Looks like a doc, behaves like a form"
 *   - One primary action per screen, brand-coloured
 *
 * Defaults to 3 empty rows; user can add rows up to 200, paste CSV, or
 * import a Ragas/DeepEval JSON file (week 2).
 */

const CATEGORIES: EvalCategory[] = [
  'factual',
  'reasoning',
  'summarization',
  'code',
  'creative',
  'edge_case',
  'other',
];

type Row = Partial<EvalCase> & { id: string };

function emptyRow(): Row {
  return {
    id: shortId('case'),
    question: '',
    expected: '',
    context: '',
    category: 'other',
    weight: 1,
  };
}

export default function NewRunPage() {
  const router = useRouter();
  const [rows, setRows] = useState<Row[]>([emptyRow(), emptyRow(), emptyRow()]);
  const [endpoint, setEndpoint] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [model, setModel] = useState('');
  const [goalScore, setGoalScore] = useState(0.95);
  const [budgetUsd, setBudgetUsd] = useState(5);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  function updateRow(idx: number, patch: Partial<Row>) {
    setRows((rs) => rs.map((r, i) => (i === idx ? { ...r, ...patch } : r)));
  }
  function addRow() {
    setRows((rs) => [...rs, emptyRow()]);
  }
  function removeRow(idx: number) {
    setRows((rs) => (rs.length > 1 ? rs.filter((_, i) => i !== idx) : rs));
  }

  function handleCsv(file: File) {
    const reader = new FileReader();
    reader.onload = () => {
      const text = String(reader.result ?? '');
      const lines = text.split(/\r?\n/).filter(Boolean);
      // Tolerant CSV: header optional. Columns expected: question,expected,context,category,weight
      const start = /question/i.test(lines[0] ?? '') ? 1 : 0;
      const parsed: Row[] = [];
      for (let i = start; i < lines.length; i++) {
        const cols = splitCsvLine(lines[i]);
        if (cols.length < 2) continue;
        parsed.push({
          id: shortId('case'),
          question: cols[0] ?? '',
          expected: cols[1] ?? '',
          context: cols[2] ?? '',
          category: ((cols[3] ?? 'other') as EvalCategory) ?? 'other',
          weight: Number(cols[4] ?? '1') || 1,
        });
      }
      if (parsed.length) setRows(parsed);
    };
    reader.readAsText(file);
  }

  async function handleSubmit() {
    setSubmitError(null);
    const cases = rows
      .filter((r) => r.question?.trim() && r.expected?.trim())
      .map((r) => ({
        id: r.id,
        question: (r.question ?? '').trim(),
        expected: (r.expected ?? '').trim(),
        context: r.context?.trim() ? r.context.trim() : undefined,
        category: r.category ?? 'other',
        weight: r.weight ?? 1,
      }));

    if (cases.length < 1) {
      setSubmitError('Add at least one question with both question and expected answer.');
      return;
    }
    if (!endpoint) {
      setSubmitError('Your AI endpoint URL is required.');
      return;
    }

    setSubmitting(true);
    try {
      const r = await fetch('/api/runs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          cases,
          sut: {
            endpoint,
            api_key: apiKey || undefined,
            model: model || undefined,
            timeout_seconds: 60,
            extra_headers: {},
          },
          goal_score: goalScore,
          budget_cap_usd: budgetUsd,
        }),
      });
      const data = await r.json();
      if (!r.ok) {
        setSubmitError(data.error ?? `Server error (${r.status}).`);
        return;
      }
      router.push(`/runs/${data.run_id}`);
    } catch (e) {
      setSubmitError(e instanceof Error ? e.message : 'Network error');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="min-h-screen bg-surface-page">
      <header className="border-b border-border bg-background/60 backdrop-blur sticky top-0 z-10">
        <div className="mx-auto max-w-5xl px-6 h-14 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2 text-sm text-text-secondary hover:text-foreground">
            <ArrowLeft className="h-4 w-4" /> Back
          </Link>
          <h1 className="font-medium tracking-tight">New eval run</h1>
          <div className="w-12" />
        </div>
      </header>

      <div className="mx-auto max-w-5xl px-6 py-8 space-y-6">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Your AI under test</CardTitle>
            <CardDescription>
              Paste an OpenAI-compatible chat-completions endpoint. We&apos;ll POST each
              question to it and read the answer from <code className="text-xs">choices[0].message.content</code>.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <Field label="Endpoint URL" required>
              <Input
                placeholder="https://api.openai.com/v1/chat/completions"
                value={endpoint}
                onChange={(e) => setEndpoint(e.target.value)}
              />
            </Field>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <Field label="API key (optional)">
                <Input
                  placeholder="sk-..."
                  type="password"
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  autoComplete="off"
                />
              </Field>
              <Field label="Model (optional)">
                <Input
                  placeholder="gpt-4o-mini, claude-sonnet-4-5, etc."
                  value={model}
                  onChange={(e) => setModel(e.target.value)}
                />
              </Field>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="text-base">Eval cases</CardTitle>
                <CardDescription>
                  At minimum, fill question + expected. Context is optional but helps the judge.
                </CardDescription>
              </div>
              <div className="flex items-center gap-2">
                <label className="inline-flex h-8 items-center gap-2 rounded-md border border-border bg-transparent px-3 text-xs font-medium text-foreground hover:bg-secondary cursor-pointer transition-colors">
                  <Upload className="h-3.5 w-3.5" /> Import CSV
                  <input
                    type="file"
                    accept=".csv,.txt"
                    className="hidden"
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) handleCsv(f);
                      e.currentTarget.value = '';
                    }}
                  />
                </label>
                <Button variant="ghost" size="sm" onClick={addRow}>
                  <Plus className="h-3.5 w-3.5" /> Add row
                </Button>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid grid-cols-12 gap-2 px-1 text-[11px] uppercase tracking-wider text-text-tertiary font-mono">
              <div className="col-span-1">#</div>
              <div className="col-span-4">Question</div>
              <div className="col-span-4">Expected</div>
              <div className="col-span-2">Category</div>
              <div className="col-span-1">Weight</div>
            </div>
            {rows.map((row, idx) => (
              <div
                key={row.id}
                className="grid grid-cols-12 gap-2 items-start rounded-md border border-border bg-card p-2 hover:border-ring/40 transition-colors"
              >
                <div className="col-span-1 pt-2 text-text-tertiary text-xs font-mono">
                  {String(idx + 1).padStart(2, '0')}
                </div>
                <div className="col-span-4">
                  <Textarea
                    rows={2}
                    placeholder="What's the user input?"
                    value={row.question ?? ''}
                    onChange={(e) => updateRow(idx, { question: e.target.value })}
                  />
                  <Input
                    className="mt-2 text-xs"
                    placeholder="Optional ground-truth context (RAG passage, system fact)"
                    value={row.context ?? ''}
                    onChange={(e) => updateRow(idx, { context: e.target.value })}
                  />
                </div>
                <div className="col-span-4">
                  <Textarea
                    rows={3}
                    placeholder="The correct answer your AI should produce"
                    value={row.expected ?? ''}
                    onChange={(e) => updateRow(idx, { expected: e.target.value })}
                  />
                </div>
                <div className="col-span-2">
                  <select
                    className="h-9 w-full rounded-md border border-border bg-[var(--input-background)] px-2 text-sm"
                    value={row.category ?? 'other'}
                    onChange={(e) =>
                      updateRow(idx, { category: e.target.value as EvalCategory })
                    }
                  >
                    {CATEGORIES.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="col-span-1 flex items-start gap-1">
                  <Input
                    type="number"
                    min={0}
                    max={10}
                    step={0.5}
                    value={row.weight ?? 1}
                    onChange={(e) =>
                      updateRow(idx, { weight: Number(e.target.value) || 1 })
                    }
                  />
                  <button
                    onClick={() => removeRow(idx)}
                    className="mt-1.5 text-text-tertiary hover:text-destructive transition-colors"
                    title="Remove row"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Run goals</CardTitle>
            <CardDescription>
              We&apos;ll keep iterating until we hit your goal score, run out of budget,
              or get 5 rounds without improvement.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <Field label="Goal score (0–1)">
                <Input
                  type="number"
                  min={0.5}
                  max={1}
                  step={0.05}
                  value={goalScore}
                  onChange={(e) => setGoalScore(Number(e.target.value) || 0.95)}
                />
              </Field>
              <Field label="Budget cap (USD)">
                <Input
                  type="number"
                  min={1}
                  max={50}
                  step={1}
                  value={budgetUsd}
                  onChange={(e) => setBudgetUsd(Number(e.target.value) || 5)}
                />
              </Field>
            </div>
          </CardContent>
        </Card>

        {submitError && (
          <div className="rounded-md border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
            {submitError}
          </div>
        )}

        <div className="flex items-center justify-end gap-2 pb-12">
          <Link href="/">
            <Button variant="ghost">Cancel</Button>
          </Link>
          <Button variant="brand" size="lg" onClick={handleSubmit} disabled={submitting}>
            {submitting ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Starting…
              </>
            ) : (
              <>
                <Sparkles className="h-4 w-4" />
                Run evals
              </>
            )}
          </Button>
        </div>
      </div>
    </main>
  );
}

function Field({
  label,
  required,
  children,
}: {
  label: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="text-xs font-medium text-text-secondary mb-1.5 block">
        {label}
        {required && <span className="text-destructive ml-1">*</span>}
      </label>
      {children}
    </div>
  );
}

/** Tolerant CSV split — handles quoted commas. Good enough for week 1. */
function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') {
      inQ = !inQ;
      continue;
    }
    if (c === ',' && !inQ) {
      out.push(cur);
      cur = '';
      continue;
    }
    cur += c;
  }
  out.push(cur);
  return out;
}
