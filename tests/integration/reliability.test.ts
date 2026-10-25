import { describe, expect, it } from "vitest";
import postgres from "postgres";
import { assertDisposableTestDatabase } from "../support/db-safety";
import { migrate } from "../../scripts/db/migrate";

describe("migration runner", () => {
  it("serializes concurrent runners and applies each migration exactly once", async () => {
    const base = assertDisposableTestDatabase(process.env.TEST_DATABASE_URL ?? "postgres://postgres@127.0.0.1:54329/cornerops_test");
    const scratch = assertDisposableTestDatabase(base.url.replace(/\/cornerops_test(_[a-z0-9]+)?$/, "/cornerops_test_migrations"));
    const admin = postgres(scratch.adminUrl, { max: 1, onnotice: () => {} });
    await admin.unsafe(`drop database if exists ${scratch.quotedDatabase} with (force)`);
    await admin.unsafe(`create database ${scratch.quotedDatabase}`);
    try {
      const results = await Promise.all([1, 2, 3].map(() => migrate(scratch.url, { localEmulation: true, log: () => {} })));
      expect(results.reduce((s, r) => s + r.applied, 0)).toBe(results[0].total);
      const sql = postgres(scratch.url, { max: 1, onnotice: () => {} });
      const [r] = await sql`select count(*)::int n, count(distinct version)::int d from cornerops_internal.schema_migrations`;
      await sql.end();
      expect(r.n).toBe(results[0].total);
      expect(r.d).toBe(r.n);
    } finally {
      await admin.unsafe(`drop database if exists ${scratch.quotedDatabase} with (force)`);
      await admin.end();
    }
  });
});

describe("readiness", () => {
  it("is not ready when migrations are missing or the ledger is absent", async () => {
    const { checkReadiness } = await import("@/server/health");
    const ready = await checkReadiness();
    expect(ready.ready).toBe(true);
    const sql = postgres(process.env.DATABASE_URL!, { max: 1, onnotice: () => {} });
    const [last] = await sql`select version, name, checksum from cornerops_internal.schema_migrations order by version desc limit 1`;
    await sql`delete from cornerops_internal.schema_migrations where version = ${last.version}`;
    try {
      const notReady = await checkReadiness();
      expect(notReady.ready).toBe(false);
      expect(notReady.checks.migrations.status).toBe("fail");
    } finally {
      await sql`insert into cornerops_internal.schema_migrations (version, name, checksum) values (${last.version}, ${last.name}, ${last.checksum})`;
      await sql.end();
    }
  });
});

describe("connection pool", () => {
  it("demo actions do not open a second pooled transaction while holding one", async () => {
    const { withUserTransaction } = await import("@/server/db/transaction");
    const { getDemoFeed } = await import("@/server/demo/simulation");
    const [u] = await (await import("../support/helpers")).system((db) => db`select user_id from organization_memberships where organization_id = 'org_cornerops_demo' and role = 'ADMIN' limit 1`);
    const prev = process.env.DATABASE_POOL_MAX;
    process.env.DATABASE_POOL_MAX = "1";
    const { closeSql } = await import("@/server/db/client");
    await closeSql();
    try {
      const run = withUserTransaction(String(u.user_id), (db) => getDemoFeed("org_cornerops_demo", 5, db));
      const outcome = await Promise.race([run.then(() => "done"), new Promise((r) => setTimeout(() => r("deadlock"), 5000))]);
      expect(outcome).toBe("done");
    } finally {
      process.env.DATABASE_POOL_MAX = prev;
      await closeSql();
    }
  });
});
