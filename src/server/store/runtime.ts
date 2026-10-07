import "server-only";
import { createMockAdapters, type MockAdapterRegistry } from "@/adapters/registry";
import { createRng, type Rng } from "@/lib/rng";
import { generateDemoDatabase } from "../seed/generate";
import { createMockBackend } from "./backend";
import type { Database } from "./types";

export interface Runtime {
  db: Database;
  adapters: MockAdapterRegistry;
  rng: Rng;
  ticking: Promise<void> | null;
}

const globalForRuntime = globalThis as unknown as { __corneropsRuntime?: Runtime };

function createRuntime(): Runtime {
  const db = generateDemoDatabase(Date.now());
  const rng = createRng(Date.now() % 2_147_483_647);
  const backend = createMockBackend(db, () => Date.now(), rng.next);
  return { db, adapters: createMockAdapters(backend), rng, ticking: null };
}

/**
 * Process-wide demo runtime. In v0.1 the operational store lives in memory
 * (seeded on boot); the Postgres schema in supabase/migrations mirrors it.
 */
export function getRuntime(): Runtime {
  globalForRuntime.__corneropsRuntime ??= createRuntime();
  return globalForRuntime.__corneropsRuntime;
}

export function resetRuntime(): Runtime {
  globalForRuntime.__corneropsRuntime = createRuntime();
  return globalForRuntime.__corneropsRuntime;
}
