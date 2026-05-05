import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';

export default function SettingsPage() {
  return (
    <main className="min-h-screen bg-surface-page">
      <header className="border-b border-border bg-background/60 backdrop-blur sticky top-0 z-10">
        <div className="mx-auto max-w-5xl px-6 h-14 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2 text-sm text-text-secondary hover:text-foreground">
            <ArrowLeft className="h-4 w-4" /> Home
          </Link>
          <h1 className="font-medium tracking-tight">Settings</h1>
          <div className="w-12" />
        </div>
      </header>

      <div className="mx-auto max-w-5xl px-6 py-8 space-y-4">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Judge model</CardTitle>
            <CardDescription>
              The model used by the rubric judge. Set via <code className="text-xs">JUDGE_MODEL</code> env var.
              Pick a different family than your AI under test to avoid same-family bias.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <pre className="font-mono text-xs text-text-secondary bg-surface-subtle rounded-md p-3 border border-border">
{`JUDGE_MODEL=gpt-4o
JUDGE_PROVIDER=openai
OPENAI_API_KEY=sk-...`}
            </pre>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">DeepEval sidecar</CardTitle>
            <CardDescription>
              EvalForge talks to a Python service for rubric scoring. Default URL below.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <pre className="font-mono text-xs text-text-secondary bg-surface-subtle rounded-md p-3 border border-border">
{`DEEPEVAL_URL=http://localhost:8787

# Start it locally:
cd deepeval-svc
uvicorn app.main:app --reload --port 8787`}
            </pre>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Coming in week 3+</CardTitle>
            <CardDescription>
              DSPy optimizer URL, multi-judge consensus toggle, Postgres connection, Stripe.
            </CardDescription>
          </CardHeader>
        </Card>
      </div>
    </main>
  );
}
