/**
 * Generic helper to call any endpoint on the Python sidecar — clustering,
 * DSPy optimization, future endpoints all share the same client.
 *
 * We deliberately keep DeepEval scoring on its own dedicated tool
 * (`call-deepeval.ts`) because it's the heavy critical-path call and
 * deserves dedicated typing + retries. Everything else routes here.
 */

const PY_URL = process.env.DEEPEVAL_URL ?? 'http://localhost:8787';

export async function callPyService<T>(
  path: string,
  body: unknown,
  opts: { timeoutMs?: number } = {}
): Promise<T> {
  const r = await fetch(`${PY_URL}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(opts.timeoutMs ?? 180_000),
  });
  if (!r.ok) {
    const errBody = await r.text().catch(() => '');
    throw new Error(`Py sidecar ${path} returned ${r.status}: ${errBody.slice(0, 500)}`);
  }
  return (await r.json()) as T;
}
