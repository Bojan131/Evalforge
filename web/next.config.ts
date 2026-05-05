import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  experimental: {
    // Mastra ships ESM. Keep this off the strict-CJS path.
    serverComponentsExternalPackages: ['@mastra/core'],
  },
  // Surface stack traces in dev so the orchestrator's DeepEval-sidecar errors
  // are easy to diagnose.
  reactStrictMode: true,
};

export default nextConfig;
