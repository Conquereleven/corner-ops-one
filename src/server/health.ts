import "server-only";
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { appEnv, appMode, authProviderName } from "./config";
import { getSql } from "./db/client";

type Status = "ok" | "fail";

export interface Readiness {
  ready: boolean;
  checks: {
    config: { status: Status; message?: string };
    database: { status: Status; latencyMs?: number };
    migrations: { status: Status; expected: number; applied: number; missing: string[]; mismatched: string[]; latest: string | null };
    schema: { status: Status; missing: string[] };
  };
}

/** Database objects the running code depends on (a missing one means an incomplete migration). */
const REQUIRED_OBJECTS: { kind: "table" | "function"; name: string }[] = [
  { kind: "table", name: "public.order_inventory_shortfalls" },
  { kind: "table", name: "public.demo_identities" },
  { kind: "function", name: "public.apply_order_transition" },
  { kind: "function", name: "public.record_inventory_movement" },
  { kind: "function", name: "public.resolve_order_shortfall" },
  { kind: "function", name: "public.financial_order_fees" },
  { kind: "function", name: "public.demo_feed" },
];

function migrationFiles() {
  const dir = join(process.cwd(), "supabase/migrations");
  return readdirSync(dir)
    .filter((f) => /^\d{14}_.+\.sql$/.test(f))
    .sort()
    .map((f) => ({ version: f.slice(0, 14), checksum: createHash("sha256").update(readFileSync(join(dir, f), "utf8")).digest("hex") }));
}

/**
 * Readiness: configuration valid, database reachable, every migration in this
 * build applied with a matching checksum, and the objects the code calls exist.
 * Never reports secrets.
 */
export async function checkReadiness(): Promise<Readiness> {
  const checks: Readiness["checks"] = {
    config: { status: "ok" },
    database: { status: "fail" },
    migrations: { status: "fail", expected: 0, applied: 0, missing: [], mismatched: [], latest: null },
    schema: { status: "fail", missing: [] },
  };
  try {
    appEnv();
    appMode();
    authProviderName();
  } catch (err) {
    checks.config = { status: "fail", message: err instanceof Error ? err.message : "invalid configuration" };
  }

  try {
    const sql = getSql();
    const started = Date.now();
    await sql`select 1`;
    checks.database = { status: "ok", latencyMs: Date.now() - started };

    const files = migrationFiles();
    const [ledger] = await sql`select to_regclass('cornerops_internal.schema_migrations') is not null as present`;
    const applied = ledger.present
      ? new Map((await sql`select version, checksum from cornerops_internal.schema_migrations`).map((r) => [String(r.version), String(r.checksum)]))
      : new Map<string, string>();
    const missing = files.filter((f) => !applied.has(f.version)).map((f) => f.version);
    const mismatched = files.filter((f) => applied.has(f.version) && applied.get(f.version) !== f.checksum).map((f) => f.version);
    checks.migrations = {
      status: ledger.present && !missing.length && !mismatched.length ? "ok" : "fail",
      expected: files.length,
      applied: applied.size,
      missing,
      mismatched,
      latest: [...applied.keys()].sort().at(-1) ?? null,
    };

    const absent: string[] = [];
    for (const o of REQUIRED_OBJECTS) {
      const [schema, name] = o.name.split(".");
      const [r] =
        o.kind === "table"
          ? await sql`select to_regclass(${o.name}) is not null as ok`
          : await sql`select exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = ${schema} and p.proname = ${name}) as ok`;
      if (!r.ok) absent.push(o.name);
    }
    checks.schema = { status: absent.length ? "fail" : "ok", missing: absent };
  } catch {
    // database stays "fail"; later checks keep their failing defaults
  }

  const ready = Object.values(checks).every((c) => c.status === "ok");
  return { ready, checks };
}

/** HTTP response for the readiness probes (200 ready / 503 not ready). */
export async function readinessResponse() {
  const started = Date.now();
  const r = await checkReadiness();
  return Response.json(
    { status: r.ready ? "ok" : "not_ready", service: "cornerops-one", ...r.checks, latencyMs: Date.now() - started },
    { status: r.ready ? 200 : 503, headers: { "Cache-Control": "no-store" } },
  );
}
