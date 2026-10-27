/**
 * Applies supabase/migrations/*.sql in version order and records them in
 * cornerops_internal.schema_migrations. Used for local development, tests, CI
 * and (as a gated, manual step) hosted environments.
 *
 *   npm run db:migrate [-- --local-emulation]      local (.env.local)
 *   npm run db:migrate:status                      read-only plan: applied / pending / changed
 *   npm run db:migrate:deploy                      MIGRATION_DATABASE_URL + MIGRATION_CONFIRM
 *
 * Connection rules (direct/session connection, no transaction pooler, explicit
 * confirmation for non-local targets) live in ./migration-config.ts.
 *
 * --local-emulation first installs supabase/local/* (auth schema, roles) and is
 * refused for any hosted Supabase URL.
 *
 * Safety: runners are serialized with a session advisory lock (concurrent
 * deploys wait instead of racing), and each migration file runs in its own
 * transaction together with its ledger row, so a failure leaves neither a
 * half-applied file nor an unrecorded one. Checksums are computed on the file
 * exactly as committed.
 */
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import postgres from "postgres";

import { MigrationConfigError, resolveMigrationTarget } from "./migration-config";

const ROOT = resolve(__dirname, "../..");
const LOCK_KEY = "cornerops:schema-migrations";

/**
 * Files wrap themselves in a top-level `begin;` … `commit;` (so they also work
 * with psql / supabase db push). The runner supplies the transaction instead,
 * so those two statements are removed — only exact top-level lines, never
 * anything inside function bodies (PL/pgSQL `begin` has no semicolon).
 */
export function transactionalBody(body: string): string {
  const lines = body.split("\n");
  const first = lines.findIndex((l) => l.trim().toLowerCase() === "begin;");
  let last = -1;
  for (let i = lines.length - 1; i >= 0; i--) {
    if (lines[i].trim().toLowerCase() === "commit;") {
      last = i;
      break;
    }
  }
  if (first !== -1 && last > first) {
    lines[first] = "";
    lines[last] = "";
  }
  return lines.join("\n");
}

export function migrationFiles(target?: string) {
  return readdirSync(join(ROOT, "supabase/migrations"))
    .filter((f) => /^\d{14}_.+\.sql$/.test(f))
    .sort()
    .filter((f) => !target || f.slice(0, 14) <= target)
    .map((file) => {
      const body = readFileSync(join(ROOT, "supabase/migrations", file), "utf8");
      return { file, version: file.slice(0, 14), body, checksum: createHash("sha256").update(body).digest("hex") };
    });
}

/** Read-only comparison of the ledger with this build's migration files. */
export async function migrationStatus(url: string) {
  const sql = postgres(url, { max: 1, onnotice: () => {} });
  try {
    const [ledger] = await sql`select to_regclass('cornerops_internal.schema_migrations') is not null as present`;
    const applied = ledger.present
      ? new Map((await sql`select version, checksum from cornerops_internal.schema_migrations`).map((r) => [String(r.version), String(r.checksum)]))
      : new Map<string, string>();
    const files = migrationFiles();
    const known = new Set(files.map((f) => f.version));
    return {
      pending: files.filter((f) => !applied.has(f.version)).map((f) => f.file),
      changed: files.filter((f) => applied.has(f.version) && applied.get(f.version) !== f.checksum).map((f) => f.file),
      /** Applied in the database but unknown to this build (the build is older than the schema). */
      unknown: [...applied.keys()].filter((v) => !known.has(v)).sort(),
      appliedCount: applied.size,
    };
  } finally {
    await sql.end();
  }
}

export async function migrate(url: string, opts: { localEmulation?: boolean; log?: (m: string) => void; target?: string } = {}) {
  const log = opts.log ?? console.log;
  if (opts.localEmulation && /supabase\.(co|com)/.test(url)) {
    throw new Error("Refusing to install local Supabase emulation on a hosted Supabase database.");
  }
  const sql = postgres(url, { max: 1, onnotice: () => {} });
  try {
    // Session-level lock on the single connection: held until released below or the connection ends.
    await sql`select pg_advisory_lock(hashtext(${LOCK_KEY}))`;
    if (opts.localEmulation) {
      for (const f of readdirSync(join(ROOT, "supabase/local")).filter((f) => f.endsWith(".sql")).sort()) {
        await sql.begin((tx) => tx.unsafe(transactionalBody(readFileSync(join(ROOT, "supabase/local", f), "utf8"))));
      }
    }
    await sql.unsafe(`
      create schema if not exists cornerops_internal;
      create table if not exists cornerops_internal.schema_migrations (
        version text primary key, name text not null, checksum text not null, applied_at timestamptz not null default now()
      );`);
    const applied = new Map((await sql`select version, checksum from cornerops_internal.schema_migrations`).map((r) => [r.version as string, r.checksum as string]));
    // `target` (a version) stops after that migration — used to build older schemas for upgrade tests.
    const files = migrationFiles(opts.target);
    let count = 0;
    for (const { file, version, body, checksum } of files) {
      if (applied.has(version)) {
        if (applied.get(version) !== checksum) throw new Error(`Migration ${file} changed after it was applied (checksum mismatch).`);
        continue;
      }
      await sql.begin(async (tx) => {
        await tx.unsafe(transactionalBody(body));
        await tx`insert into cornerops_internal.schema_migrations (version, name, checksum) values (${version}, ${file}, ${checksum})`;
      });
      log(`applied ${file}`);
      count += 1;
    }
    log(count ? `${count} migration(s) applied` : "database is up to date");
    return { applied: count, total: files.length };
  } finally {
    await sql`select pg_advisory_unlock_all()`.catch(() => {});
    await sql.end();
  }
}

async function main() {
  const statusOnly = process.argv.includes("--status");
  const latestVersion = migrationFiles().at(-1)?.version ?? "";
  const { url } = resolveMigrationTarget(process.env, { latestVersion, statusOnly });
  if (statusOnly) {
    const s = await migrationStatus(url);
    console.log(JSON.stringify({ latestInBuild: latestVersion, ...s }, null, 2));
    if (s.changed.length) process.exitCode = 2;
    return;
  }
  await migrate(url, { localEmulation: process.argv.includes("--local-emulation") });
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err instanceof MigrationConfigError ? `[migrate] ${err.message}` : err.message);
    process.exit(1);
  });
}
