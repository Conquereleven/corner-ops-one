/**
 * Fail-closed guard for destructive test database setup.
 *
 * The integration suite DROPS and recreates its database. This guard runs
 * before any connection is opened and refuses anything that is not provably a
 * disposable, local test database:
 *
 *   1. explicit opt-in: CORNEROPS_TEST_DB_DISPOSABLE=1 (set by `npm run test:integration` and CI)
 *   2. never in staging/production runtimes (APP_ENV / NODE_ENV)
 *   3. postgres:// or postgresql:// URL only
 *   4. host must be loopback (127.0.0.1, ::1, localhost) — no hosted, pooler or shared hosts
 *   5. no connection parameters that can redirect the host (host, hostaddr, service, …)
 *   6. database name must match ^cornerops_test(_[a-z0-9]{1,32})?$
 *
 * A loopback hostname alone does not prove the server is ours (an SSH tunnel or
 * port-forward to a hosted database also looks like 127.0.0.1). Before anything
 * destructive, verifyDisposableServer() therefore checks the server itself:
 *
 *   7. the cluster carries the ownership marker database `cornerops_disposable_cluster`,
 *      created only by scripts/db/local.sh (project-local cluster) and the CI service container
 *   8. no managed-service fingerprint (Supabase, RDS, Cloud SQL, Azure admin roles)
 */
export interface DisposableDatabase {
  url: string;
  adminUrl: string;
  host: string;
  port: number;
  database: string;
  /** Safely quoted identifier for DDL. */
  quotedDatabase: string;
}

export class UnsafeTestDatabaseError extends Error {
  constructor(reason: string) {
    super(`Refusing to reset test database: ${reason}`);
    this.name = "UnsafeTestDatabaseError";
  }
}

const LOOPBACK = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);
const NAME = /^cornerops_test(_[a-z0-9]{1,32})?$/;
const REDIRECTING_PARAMS = ["host", "hostaddr", "service", "servicefile", "options", "dbname", "database"];

export function quoteIdentifier(name: string): string {
  if (!NAME.test(name)) throw new UnsafeTestDatabaseError(`invalid database identifier "${name}"`);
  return `"${name.replace(/"/g, '""')}"`;
}

export function assertDisposableTestDatabase(raw: string | undefined, env: Record<string, string | undefined> = process.env): DisposableDatabase {
  if (env.CORNEROPS_TEST_DB_DISPOSABLE !== "1") {
    throw new UnsafeTestDatabaseError("CORNEROPS_TEST_DB_DISPOSABLE=1 is not set (use `npm run test:integration`)");
  }
  if (["staging", "production"].includes(env.APP_ENV ?? "") || env.NODE_ENV === "production") {
    throw new UnsafeTestDatabaseError("destructive tests are disabled in staging/production runtimes");
  }
  if (!raw) throw new UnsafeTestDatabaseError("no database URL");

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new UnsafeTestDatabaseError("database URL is not parseable");
  }
  if (url.protocol !== "postgres:" && url.protocol !== "postgresql:") {
    throw new UnsafeTestDatabaseError(`unsupported protocol "${url.protocol}"`);
  }
  const host = url.hostname.toLowerCase();
  if (!LOOPBACK.has(host)) throw new UnsafeTestDatabaseError(`host "${host}" is not a local loopback host`);
  for (const p of url.searchParams.keys()) {
    if (REDIRECTING_PARAMS.includes(p.toLowerCase())) throw new UnsafeTestDatabaseError(`connection parameter "${p}" is not allowed`);
  }
  const database = decodeURIComponent(url.pathname.replace(/^\//, ""));
  if (!NAME.test(database)) {
    throw new UnsafeTestDatabaseError(`database "${database}" is not an explicitly disposable test database (cornerops_test[_suffix])`);
  }
  const port = url.port ? Number(url.port) : 5432;
  const admin = new URL(url.toString());
  admin.pathname = "/postgres";
  return { url: url.toString(), adminUrl: admin.toString(), host, port, database, quotedDatabase: quoteIdentifier(database) };
}

export const CLUSTER_MARKER = "cornerops_disposable_cluster";
const MANAGED_ROLES = ["supabase_admin", "supabase_auth_admin", "rdsadmin", "rds_superuser", "cloudsqladmin", "cloudsqlsuperuser", "azure_superuser", "azure_pg_admin", "alloydbadmin"];

export interface ServerFacts {
  /** inet_server_addr() as seen by the server (null for a Unix socket). Informational only. */
  serverAddress: string | null;
  hasClusterMarker: boolean;
  managedRoles: string[];
}

/** Pure decision on facts gathered from the server (unit-tested). */
export function assertDisposableServer(facts: ServerFacts): void {
  if (facts.managedRoles.length) {
    throw new UnsafeTestDatabaseError(`server looks like a managed/hosted database (roles: ${facts.managedRoles.join(", ")})`);
  }
  if (!facts.hasClusterMarker) {
    throw new UnsafeTestDatabaseError(
      `server${facts.serverAddress ? ` (${facts.serverAddress})` : ""} has no "${CLUSTER_MARKER}" ownership marker — ` +
        "a loopback address is not proof of a disposable server (start the project cluster with scripts/db/local.sh)",
    );
  }
}

type Query = (strings: TemplateStringsArray, ...values: unknown[]) => Promise<Record<string, unknown>[]>;

/** Gather server facts over an existing (admin) connection and apply assertDisposableServer. Read-only. */
export async function verifyDisposableServer(sql: Query): Promise<ServerFacts> {
  const [r] = await sql`
    select host(inet_server_addr()) as addr,
           exists (select 1 from pg_database where datname = ${CLUSTER_MARKER}) as marker,
           coalesce((select array_agg(rolname order by rolname) from pg_roles where rolname = any (${MANAGED_ROLES})), '{}') as managed`;
  const facts: ServerFacts = { serverAddress: (r.addr as string) ?? null, hasClusterMarker: Boolean(r.marker), managedRoles: (r.managed as string[]) ?? [] };
  assertDisposableServer(facts);
  return facts;
}
