import { describe, expect, it } from "vitest";
import { assertDisposableServer, assertDisposableTestDatabase, quoteIdentifier, UnsafeTestDatabaseError } from "../support/db-safety";

const OK_ENV = { CORNEROPS_TEST_DB_DISPOSABLE: "1" };
const ok = (url: string, env: Record<string, string | undefined> = OK_ENV) => assertDisposableTestDatabase(url, env);

describe("destructive test database guard", () => {
  it("accepts an explicitly disposable local database", () => {
    const t = ok("postgres://postgres@127.0.0.1:54329/cornerops_test");
    expect(t.database).toBe("cornerops_test");
    expect(t.quotedDatabase).toBe('"cornerops_test"');
    expect(t.adminUrl).toBe("postgres://postgres@127.0.0.1:54329/postgres");
    expect(ok("postgresql://ci:ci@localhost:5432/cornerops_test_ci42").database).toBe("cornerops_test_ci42");
    expect(ok("postgres://postgres@[::1]:5432/cornerops_test").host).toBe("[::1]");
  });

  it.each([
    ["hosted Supabase direct", "postgres://postgres:pw@db.abcdefghijklmnopqrst.supabase.co:5432/postgres"],
    ["Supabase pooler", "postgres://postgres.ref:pw@aws-0-ap-south-1.pooler.supabase.com:6543/cornerops_test"],
    ["remote host with test name", "postgres://u:p@10.0.0.5:5432/cornerops_test"],
    ["staging host", "postgres://u:p@staging-db.internal:5432/cornerops_test"],
    ["production database name locally", "postgres://postgres@127.0.0.1:5432/cornerops"],
    ["postgres maintenance db", "postgres://postgres@127.0.0.1:5432/postgres"],
    ["look-alike name", "postgres://postgres@127.0.0.1:5432/cornerops_test_prod-copy"],
    ["prefix trick", "postgres://postgres@127.0.0.1:5432/cornerops_testing"],
    ["injection attempt", 'postgres://postgres@127.0.0.1:5432/cornerops_test%22;drop%20database%20x;--'],
    ["host override param", "postgres://postgres@127.0.0.1:5432/cornerops_test?host=db.example.com"],
    ["hostaddr override param", "postgres://postgres@127.0.0.1:5432/cornerops_test?hostaddr=10.1.1.1"],
    ["service param", "postgres://postgres@127.0.0.1:5432/cornerops_test?service=prod"],
    ["non-postgres protocol", "mysql://root@127.0.0.1:3306/cornerops_test"],
    ["garbage", "not a url"],
  ])("rejects %s", (_label, url) => {
    expect(() => ok(url)).toThrow(UnsafeTestDatabaseError);
  });

  it("requires explicit opt-in", () => {
    expect(() => ok("postgres://postgres@127.0.0.1:54329/cornerops_test", {})).toThrow(/CORNEROPS_TEST_DB_DISPOSABLE/);
  });

  it("refuses in staging/production runtimes", () => {
    expect(() => ok("postgres://postgres@127.0.0.1:54329/cornerops_test", { ...OK_ENV, APP_ENV: "production" })).toThrow();
    expect(() => ok("postgres://postgres@127.0.0.1:54329/cornerops_test", { ...OK_ENV, APP_ENV: "staging" })).toThrow();
    expect(() => ok("postgres://postgres@127.0.0.1:54329/cornerops_test", { ...OK_ENV, NODE_ENV: "production" })).toThrow();
  });

  it("refuses a missing URL and quotes only safe identifiers", () => {
    expect(() => assertDisposableTestDatabase(undefined, OK_ENV)).toThrow();
    expect(() => quoteIdentifier('cornerops_test"; drop')).toThrow();
  });
});

describe("server ownership check (a loopback address is not proof)", () => {
  it("refuses a loopback-reachable server without the ownership marker (e.g. a tunnel to a hosted database)", () => {
    expect(() => assertDisposableServer({ serverAddress: "10.0.4.17", hasClusterMarker: false, managedRoles: [] })).toThrow(UnsafeTestDatabaseError);
    expect(() => assertDisposableServer({ serverAddress: "127.0.0.1", hasClusterMarker: false, managedRoles: [] })).toThrow(/ownership marker/);
  });
  it("refuses managed-service fingerprints even when a marker exists", () => {
    expect(() => assertDisposableServer({ serverAddress: "127.0.0.1", hasClusterMarker: true, managedRoles: ["supabase_admin"] })).toThrow(/managed/);
    expect(() => assertDisposableServer({ serverAddress: "127.0.0.1", hasClusterMarker: true, managedRoles: ["rdsadmin"] })).toThrow(/managed/);
  });
  it("accepts the project cluster / CI service container", () => {
    expect(() => assertDisposableServer({ serverAddress: "127.0.0.1", hasClusterMarker: true, managedRoles: [] })).not.toThrow();
    expect(() => assertDisposableServer({ serverAddress: "172.18.0.2", hasClusterMarker: true, managedRoles: [] })).not.toThrow();
  });
});
