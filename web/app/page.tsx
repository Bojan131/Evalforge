import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardTitle } from '@/components/ui/card';
import { ArrowRight, Activity, TestTubeDiagonal, Wrench, Gauge } from 'lucide-react';

/**
 * Landing — short, opinionated, lifted-from-SentinelQA layout but reframed
 * for an evals product. Three things only:
 *   1. The pitch in one sentence
 *   2. The how-it-works diagram in four cards
 *   3. CTA to "Start a new eval run"
 */
export default function Home() {
  return (
    <main className="min-h-screen bg-surface-page text-foreground">
      <Header />

      <section className="mx-auto max-w-5xl px-6 pt-20 pb-16">
        <p className="font-mono text-xs uppercase tracking-[0.2em] text-text-tertiary mb-6">
          EvalForge · v0.1
        </p>
        <h1 className="font-display text-5xl md:text-6xl leading-[1.05] tracking-tight max-w-3xl">
          Your AI scored 73%.
          <br />
          <span className="italic text-brand">Wake up tomorrow at 95%.</span>
        </h1>
        <p className="mt-6 text-lg text-text-secondary max-w-2xl">
          EvalForge runs your eval set, finds the failure patterns, proposes
          targeted prompt + few-shot patches, and re-scores until it hits 95%
          — or hits a budget cap and tells you why it can&apos;t.
        </p>
        <div className="mt-8 flex flex-wrap gap-3">
          <Link href="/runs/new">
            <Button variant="brand" size="lg" className="font-medium">
              Start a new eval run
              <ArrowRight className="h-4 w-4" />
            </Button>
          </Link>
          <Link href="/runs">
            <Button variant="outline" size="lg">
              See past runs
            </Button>
          </Link>
        </div>
      </section>

      <section className="mx-auto max-w-5xl px-6 pb-24">
        <h2 className="font-display text-2xl mb-8 text-text-secondary">
          How it works
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <StepCard
            n="01"
            icon={<Activity className="h-4 w-4" />}
            title="Score"
            body="Drop in 20+ questions with expected answers and ground-truth context. We call your AI, score every answer with a rubric judge."
          />
          <StepCard
            n="02"
            icon={<TestTubeDiagonal className="h-4 w-4" />}
            title="Cluster failures"
            body="Embed every failed answer, cluster by similarity, name each pattern in plain English. No more sifting through 100 wrong answers."
          />
          <StepCard
            n="03"
            icon={<Wrench className="h-4 w-4" />}
            title="Propose patch"
            body="DSPy synthesises a targeted prompt + few-shot edit aimed at the worst cluster. We never touch model weights."
          />
          <StepCard
            n="04"
            icon={<Gauge className="h-4 w-4" />}
            title="Re-score & repeat"
            body="Apply, re-score on held-out cases, regression-guard against breakage. Loop until 95% or budget cap. Audit log of every change."
          />
        </div>
      </section>

      <Footer />
    </main>
  );
}

function StepCard({
  n,
  icon,
  title,
  body,
}: {
  n: string;
  icon: React.ReactNode;
  title: string;
  body: string;
}) {
  return (
    <Card className="anim-fade-in">
      <CardContent className="p-5 pt-5">
        <div className="flex items-center justify-between mb-3">
          <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-text-tertiary">
            {n}
          </span>
          <span className="text-text-tertiary">{icon}</span>
        </div>
        <CardTitle className="text-base mb-2">{title}</CardTitle>
        <CardDescription className="text-[13px] leading-relaxed">
          {body}
        </CardDescription>
      </CardContent>
    </Card>
  );
}

function Header() {
  return (
    <header className="border-b border-border bg-background/60 backdrop-blur sticky top-0 z-10">
      <div className="mx-auto max-w-5xl px-6 h-14 flex items-center justify-between">
        <Link href="/" className="flex items-center gap-2">
          <div className="h-6 w-6 rounded-sm bg-brand flex items-center justify-center">
            <span className="font-display text-white text-sm leading-none">E</span>
          </div>
          <span className="font-medium tracking-tight">EvalForge</span>
        </Link>
        <nav className="flex items-center gap-1">
          <Link href="/runs">
            <Button variant="ghost" size="sm">Runs</Button>
          </Link>
          <Link href="/settings">
            <Button variant="ghost" size="sm">Settings</Button>
          </Link>
        </nav>
      </div>
    </header>
  );
}

function Footer() {
  return (
    <footer className="border-t border-border">
      <div className="mx-auto max-w-5xl px-6 h-14 flex items-center justify-between text-xs text-text-tertiary">
        <span>EvalForge · closed-loop AI evals</span>
        <span className="font-mono">v0.1 — week 1 foundation</span>
      </div>
    </footer>
  );
}
