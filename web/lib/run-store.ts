/**
 * In-memory run store. Replaced by Postgres in week 5.
 *
 * Why: even week 1 needs a place to land the workflow's RunState so the UI
 * can poll /api/runs/:id without re-executing. The shape matches what the
 * Postgres schema will look like, so swap is clean.
 */

import { RunState } from './types/eval';

const store = new Map<string, RunState>();

export const runStore = {
  set(state: RunState) {
    store.set(state.run_id, state);
  },
  get(runId: string): RunState | null {
    return store.get(runId) ?? null;
  },
  list(): RunState[] {
    return Array.from(store.values()).sort((a, b) =>
      b.created_at.localeCompare(a.created_at)
    );
  },
  clear() {
    store.clear();
  },
};
