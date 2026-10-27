import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { isTransactionPooler, MigrationConfigError, resolveMigrationTarget } from "../../scripts/db/migration-config";

const LATEST = "20261027100100";
const DIRECT = "postgres://postgres:x@db.abcdefghijkl.supabase.co:5432/postgres";
const SESSION_POOLER = "postgres://postgres.abcdefghijkl:x@aws-0-eu-central-1.pooler.supabase.com:5432/postgres";
const TX_POOLER = "postgres://postgres.abcdefghijkl:x@aws-0-eu-central-1.pooler.supabase.com:6543/postgres";
const LOCAL = "postgres://postgres@127.0.0.1:54329/cornerops";

describe("migration connection target", () => {
  it("detects transaction poolers", () => {
    expect(isTransactionPooler(TX_POOLER)).toBe(true);
    expect(isTransactionPooler(`${SESSION_POOLER}?pgbouncer=true`)).toBe(true);
    expect(isTransactionPooler(SESSION_POOLER)).toBe(false);
    expect(isTransactionPooler(DIRECT)).toBe(false);
  });

  it("refuses a transaction pooler in every environment, even with confirmation", () => {
    for (const APP_ENV of ["development", "test", "staging", "production"]) {
      expect(() => resolveMigrationTarget({ APP_ENV, MIGRATION_DATABASE_URL: TX_POOLER, MIGRATION_CONFIRM: LATEST }, { latestVersion: LATEST })).toThrow(MigrationConfigError);
    }
  });

  it("never falls back to the runtime DATABASE_URL in staging/production", () => {
    expect(() => resolveMigrationTarget({ APP_ENV: "production", DATABASE_URL: DIRECT, MIGRATION_CONFIRM: LATEST }, { latestVersion: LATEST })).toThrow(/MIGRATION_DATABASE_URL is required/);
    expect(() => resolveMigrationTarget({ NODE_ENV: "production", DATABASE_URL: DIRECT }, { latestVersion: LATEST, statusOnly: true })).toThrow(/MIGRATION_DATABASE_URL/);
  });

  it("requires explicit confirmation of the exact latest version for non-local targets", () => {
    const env = { APP_ENV: "staging", MIGRATION_DATABASE_URL: SESSION_POOLER };
    expect(() => resolveMigrationTarget(env, { latestVersion: LATEST })).toThrow(/MIGRATION_CONFIRM=20261027100100/);
    expect(() => resolveMigrationTarget({ ...env, MIGRATION_CONFIRM: "20261026100300" }, { latestVersion: LATEST })).toThrow(MigrationConfigError);
    expect(resolveMigrationTarget({ ...env, MIGRATION_CONFIRM: LATEST }, { latestVersion: LATEST })).toEqual({ url: SESSION_POOLER, hosted: true });
    // A hosted URL in "development" still needs confirmation.
    expect(() => resolveMigrationTarget({ DATABASE_URL: DIRECT }, { latestVersion: LATEST })).toThrow(/MIGRATION_CONFIRM/);
  });

  it("allows read-only status without confirmation, and local development without ceremony", () => {
    expect(resolveMigrationTarget({ APP_ENV: "staging", MIGRATION_DATABASE_URL: DIRECT }, { latestVersion: LATEST, statusOnly: true }).hosted).toBe(true);
    expect(resolveMigrationTarget({ DATABASE_URL: LOCAL }, { latestVersion: LATEST })).toEqual({ url: LOCAL, hosted: false });
  });

  it("rejects malformed and non-postgres URLs", () => {
    expect(() => resolveMigrationTarget({ DATABASE_URL: "not a url" }, { latestVersion: LATEST })).toThrow(MigrationConfigError);
    expect(() => resolveMigrationTarget({ DATABASE_URL: "mysql://127.0.0.1/x" }, { latestVersion: LATEST })).toThrow(/postgres/);
  });
});

describe("migration credentials stay out of the application", () => {
  const root = resolve(__dirname, "../..");
  const files = (dir: string): string[] =>
    readdirSync(dir).flatMap((f) => {
      const p = join(dir, f);
      return statSync(p).isDirectory() ? files(p) : /\.(ts|tsx|js|mjs)$/.test(f) ? [p] : [];
    });

  it("no application code reads MIGRATION_DATABASE_URL, and nothing exposes it publicly", () => {
    const offenders = files(join(root, "src")).filter((f) => readFileSync(f, "utf8").includes("MIGRATION_DATABASE_URL"));
    expect(offenders).toEqual([]);
    const all = [...files(join(root, "src")), ...files(join(root, "scripts")), join(root, "next.config.ts")];
    expect(all.filter((f) => /NEXT_PUBLIC_[A-Z_]*MIGRATION/.test(readFileSync(f, "utf8")))).toEqual([]);
  });

  it("deployment never runs migrations implicitly", () => {
    const railway = JSON.parse(readFileSync(join(root, "railway.json"), "utf8"));
    expect(railway.deploy.preDeployCommand).toBeUndefined();
    expect(JSON.stringify(railway)).not.toMatch(/migrate/);
  });
});
