import { readdirSync } from "node:fs";
import { join } from "node:path";
import { appMode, authProviderName } from "@/server/config";
import { getSql } from "@/server/db/client";

export const dynamic = "force-dynamic";

/**
 * Liveness/readiness probe for the platform (Railway health check).
 * Reports database reachability and migration status; never secrets.
 */
export async function GET() {
  const started = Date.now();
  let database: "ok" | "unavailable" = "unavailable";
  let migrations: { applied: number; expected: number; latest: string | null } | null = null;
  try {
    const sql = getSql();
    await sql`select 1`;
    database = "ok";
    const rows = await sql`select version from cornerops_internal.schema_migrations order by version`.catch(() => []);
    const expected = readdirSync(join(process.cwd(), "supabase/migrations")).filter((f) => /^\d{14}_.+\.sql$/.test(f)).length;
    migrations = { applied: rows.length, expected, latest: rows.at(-1)?.version ?? null };
  } catch {
    database = "unavailable";
  }
  let config: "ok" | "invalid" = "ok";
  try {
    appMode();
    authProviderName();
  } catch {
    config = "invalid";
  }
  const healthy = database === "ok" && config === "ok";
  return Response.json(
    { status: healthy ? "ok" : "degraded", service: "cornerops-one", database, config, migrations, latencyMs: Date.now() - started },
    { status: healthy ? 200 : 503, headers: { "Cache-Control": "no-store" } },
  );
}
