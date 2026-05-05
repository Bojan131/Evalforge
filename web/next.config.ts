import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // Mastra ships ESM. Keep it off the strict-CJS path.
  // (Renamed from experimental.serverComponentsExternalPackages in Next 15.)
  serverExternalPackages: ['@mastra/core'],
  // Surface stack traces in dev so the orchestrator's DeepEval-sidecar errors
  // are easy to diagnose.
  reactStrictMode: true,
};

export default nextConfig;
