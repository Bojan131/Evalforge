/**
 * GET /api/runs/:id — fetch one run's current state.
 * Used by the results page to poll while the workflow runs.
 */

import { NextResponse } from 'next/server';
import { runStore } from '@/lib/run-store';

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  const { id } = await ctx.params;
  const run = runStore.get(id);
  if (!run) {
    return NextResponse.json({ error: 'Run not found' }, { status: 404 });
  }
  return NextResponse.json({ run });
}
