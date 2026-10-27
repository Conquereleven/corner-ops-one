/**
 * Which database the migration runner may connect to, and under what conditions.
 *
 * The runner serializes with a *session* advisory lock and runs each file in its
 * own transaction, so it needs a direct or session-mode connection. A transaction
 * pooler (Supabase pooler on port 6543, PgBouncer transaction mode) can hand
 * consecutive statements to different backends, which silently breaks the lock.
 *
 * Runtime and migrations therefore use separate settings:
 *   DATABASE_URL            web service runtime (may be the transaction pooler)
 *   MIGRATION_DATABASE_URL  migration job only (direct or session pooler); never
 *                           read by application code, never set on the web service
 */

export type MigrationEnv = Record<string, string | undefined>;

export interface MigrationTarget {
  url: string;
  hosted: boolean;
}

export class MigrationConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MigrationConfigError";
  }
}

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

function parse(url: string) {
  try {
    return new URL(url);
  } catch {
    throw new MigrationConfigError("The migration database URL is not a valid postgres:// URL.");
  }
}

/** True for connection strings that point at a transaction-mode pooler. */
export function isTransactionPooler(url: string): boolean {
  const u = parse(url);
  const params = u.searchParams;
  if (params.get("pgbouncer") === "true" || params.get("pool_mode") === "transaction") return true;
  // Supabase: port 6543 is the transaction pooler on both pooler and db hosts.
  return u.port === "6543";
}

/**
 * Resolve the migration target. Fails closed:
 * - staging/production require MIGRATION_DATABASE_URL (no fallback to the runtime URL);
 * - transaction poolers are refused everywhere;
 * - a hosted target requires MIGRATION_CONFIRM to equal the latest migration version
 *   in this build, so a deploy can never apply schema changes implicitly.
 */
export function resolveMigrationTarget(env: MigrationEnv, opts: { latestVersion: string; statusOnly?: boolean }): MigrationTarget {
  const appEnv = env.APP_ENV ?? (env.NODE_ENV === "production" ? "production" : "development");
  const strict = appEnv === "staging" || appEnv === "production";
  const url = env.MIGRATION_DATABASE_URL ?? (strict ? undefined : env.DATABASE_URL);
  if (!url) {
    throw new MigrationConfigError(
      strict
        ? "MIGRATION_DATABASE_URL is required in staging/production (a direct or session-mode connection; the runtime DATABASE_URL is not used for migrations)."
        : "Set MIGRATION_DATABASE_URL (or DATABASE_URL for local development).",
    );
  }
  const u = parse(url);
  if (u.protocol !== "postgres:" && u.protocol !== "postgresql:") throw new MigrationConfigError("The migration database URL must use postgres://.");
  if (isTransactionPooler(url)) {
    throw new MigrationConfigError(
      "Refusing to migrate through a transaction pooler (port 6543 / pgbouncer=true): session advisory locks and per-file transactions need a direct or session-mode connection.",
    );
  }
  const hosted = !LOCAL_HOSTS.has(u.hostname);
  if ((hosted || strict) && !opts.statusOnly && env.MIGRATION_CONFIRM !== opts.latestVersion) {
    throw new MigrationConfigError(
      `Refusing to apply migrations to a non-local database without MIGRATION_CONFIRM=${opts.latestVersion} ` +
        "(take a backup and run db:migrate:status first; see docs/deployment/railway.md).",
    );
  }
  return { url, hosted };
}
