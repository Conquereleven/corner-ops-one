/**
 * Applies supabase/migrations/*.sql in version order and records them in
 * cornerops_internal.schema_migrations. Used for local development, tests and
 * CI. (For hosted Supabase, `supabase db push` applies the same files.)
 *
 *   DATABASE_URL=... npm run db:migrate [-- --local-emulation]
 *
 * --local-emulation first installs supabase/local/* (auth schema, roles) and is
 * refused for any hosted Supabase URL.
 */
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import postgres from "postgres";

const ROOT = resolve(__dirname, "../..");

export async function migrate(url: string, opts: { localEmulation?: boolean; log?: (m: string) => void } = {}) {
  const log = opts.log ?? console.log;
  if (opts.localEmulation && /supabase\.(co|com)/.test(url)) {
    throw new Error("Refusing to install local Supabase emulation on a hosted Supabase database.");
  }
  const sql = postgres(url, { max: 1, onnotice: () => {} });
  try {
    if (opts.localEmulation) {
      for (const f of readdirSync(join(ROOT, "supabase/local")).filter((f) => f.endsWith(".sql")).sort()) {
        await sql.unsafe(readFileSync(join(ROOT, "supabase/local", f), "utf8"));
      }
    }
    await sql.unsafe(`
      create schema if not exists cornerops_internal;
      create table if not exists cornerops_internal.schema_migrations (
        version text primary key, name text not null, checksum text not null, applied_at timestamptz not null default now()
      );`);
    const applied = new Map((await sql`select version, checksum from cornerops_internal.schema_migrations`).map((r) => [r.version as string, r.checksum as string]));
    const files = readdirSync(join(ROOT, "supabase/migrations")).filter((f) => /^\d{14}_.+\.sql$/.test(f)).sort();
    let count = 0;
    for (const file of files) {
      const version = file.slice(0, 14);
      const body = readFileSync(join(ROOT, "supabase/migrations", file), "utf8");
      const checksum = createHash("sha256").update(body).digest("hex");
      if (applied.has(version)) {
        if (applied.get(version) !== checksum) throw new Error(`Migration ${file} changed after it was applied (checksum mismatch).`);
        continue;
      }
      await sql.unsafe(body);
      await sql`insert into cornerops_internal.schema_migrations (version, name, checksum) values (${version}, ${file}, ${checksum})`;
      log(`applied ${file}`);
      count += 1;
    }
    log(count ? `${count} migration(s) applied` : "database is up to date");
    return { applied: count, total: files.length };
  } finally {
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
