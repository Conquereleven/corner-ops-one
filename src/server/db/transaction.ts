import { fromDatabaseError } from "../errors";
import { getSql, type Db } from "./client";

/** Who is performing a write. Recorded on events, audit logs and movements. */
export type Actor = { kind: "user"; userId: string } | { kind: "system"; label: string };

export function actorColumns(actor: Actor) {
  return actor.kind === "user"
    ? { actorUserId: actor.userId, actorLabel: "user" }
    : { actorUserId: null as string | null, actorLabel: actor.label };
}

async function guard<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (err) {
    const mapped = fromDatabaseError(err);
    if (mapped) {
      Object.defineProperty(mapped, "cause", { value: err, enumerable: false });
      if (mapped.status >= 500) console.error("[db]", err);
      throw mapped;
    }
    throw err;
  }
}

/**
 * Run `fn` in a transaction as the authenticated user: the connection switches
 * to the `authenticated` role with the user's JWT claims, so every query is
 * subject to Row Level Security exactly as it would be through Supabase.
 */
export function withUserTransaction<T>(userId: string, fn: (tx: Db) => Promise<T>): Promise<T> {
  return guard(() =>
    getSql().begin(async (tx) => {
      await tx`select set_config('request.jwt.claims', ${JSON.stringify({ sub: userId, role: "authenticated" })}, true)`;
      await tx`set local role authenticated`;
      return fn(tx);
    }) as Promise<T>,
  );
}

/**
 * Privileged transaction (bypasses RLS). Only for system work that has its own
 * guards: demo seeding/reset/simulation, session bootstrap, migrations, health.
 */
export function withSystemTransaction<T>(fn: (tx: Db) => Promise<T>): Promise<T> {
  return guard(() => getSql().begin((tx) => fn(tx)) as Promise<T>);
}
