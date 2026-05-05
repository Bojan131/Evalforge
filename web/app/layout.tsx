import type { Metadata } from 'next';
import './globals.css';

// We load Inter + Instrument Serif from Google Fonts via Next's font-loader-
// free <link> approach. Keeps the bundle lean — Next 15 inlines critical
// CSS and the rest streams.
const FONT_LINKS = (
  <>
    <link rel="preconnect" href="https://fonts.googleapis.com" />
    <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
    <link
      href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Instrument+Serif:ital@0;1&family=JetBrains+Mono:wght@400;500&display=swap"
      rel="stylesheet"
    />
  </>
);

export const metadata: Metadata = {
  title: 'EvalForge — Closed-loop AI evals',
  description:
    'Score your AI, diagnose failures, auto-fix until 95%. Evals that finish the job.',
  metadataBase: new URL('http://localhost:3000'),
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    // Default to dark — most agentic dashboards live in dark and the warm
    // palette was tuned for it. Add a class toggle later for users who want light.
    <html lang="en" className="dark">
      <head>{FONT_LINKS}</head>
      <body className="bg-background text-foreground antialiased">
        {children}
      </body>
    </html>
  );
}
