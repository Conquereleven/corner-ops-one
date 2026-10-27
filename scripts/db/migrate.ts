/**
 * Applies supabase/migrations/*.sql in version order and records them in
 * cornerops_internal.schema_migrations. Used for local development, tests and
 * CI. (For hosted Supabase, `supabase db push` applies the same files.)
 *
 *   DATABASE_URL=... npm run db:migrate [-- --local-emulation]
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
    const files = readdirSync(join(ROOT, "supabase/migrations"))
      .filter((f) => /^\d{14}_.+\.sql$/.test(f))
      .sort()
      .filter((f) => !opts.target || f.slice(0, 14) <= opts.target);
    let count = 0;
    for (const file of files) {
      const version = file.slice(0, 14);
      const body = readFileSync(join(ROOT, "supabase/migrations", file), "utf8");
      const checksum = createHash("sha256").update(body).digest("hex");
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

if (require.main === module) {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("DATABASE_URL is required");
    process.exit(1);
  }
  migrate(url, { localEmulation: process.argv.includes("--local-emulation") }).catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
}
