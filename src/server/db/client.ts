import postgres from "postgres";
import { ConfigurationError } from "../errors";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Sql = postgres.Sql<any>;
/** A connection or transaction handle. Repositories accept either. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Db = postgres.Sql<any> | postgres.TransactionSql<any>;

const toIso = (v: unknown) => (v instanceof Date ? v.toISOString() : v);

function createClient(url: string, max: number): Sql {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return postgres<any>(url, {
    max,
    idle_timeout: 20,
    connect_timeout: 10,
    // Supabase's transaction pooler does not support prepared statements.
    prepare: false,
    onnotice: () => {},
    types: {
      // numeric → number (amounts are numeric(12,2), well within float precision)
      numeric: { to: 1700, from: [1700], serialize: (v: number) => String(v), parse: (v: string) => Number.parseFloat(v) },
      // timestamps → ISO strings, the format the domain model uses
      timestamp: {
        to: 1184,
        from: [1114, 1184],
        serialize: (v: unknown) => toIso(v),
        parse: (v: string) => new Date(v.includes("T") || v.includes("+") || v.endsWith("Z") ? v : `${v}Z`).toISOString(),
      },
    },
  });
}

const globalForDb = globalThis as unknown as { __corneropsSql?: Sql; __corneropsSqlUrl?: string; __corneropsSystemSql?: Sql; __corneropsSystemSqlUrl?: string };

export function databaseUrl(): string {
  const url = process.env.DATABASE_URL;
  if (!url) throw new ConfigurationError("DATABASE_URL is not configured. See .env.example.");
  return url;
}

/** Process-wide connection pool for user (RLS) requests. */
export function getSql(): Sql {
  const url = databaseUrl();
  if (!globalForDb.__corneropsSql || globalForDb.__corneropsSqlUrl !== url) {
    globalForDb.__corneropsSql = createClient(url, Number(process.env.DATABASE_POOL_MAX ?? 10));
    globalForDb.__corneropsSqlUrl = url;
  }
  return globalForDb.__corneropsSql;
}

/**
 * Small separate pool for system work (demo simulator, session bootstrap), so
 * background simulation can never starve or deadlock the request pool.
 */
export function getSystemSql(): Sql {
  const url = databaseUrl();
  if (!globalForDb.__corneropsSystemSql || globalForDb.__corneropsSystemSqlUrl !== url) {
    globalForDb.__corneropsSystemSql = createClient(url, Number(process.env.DATABASE_SYSTEM_POOL_MAX ?? 3));
    globalForDb.__corneropsSystemSqlUrl = url;
  }
  return globalForDb.__corneropsSystemSql;
}

export async function closeSql() {
  await Promise.all([globalForDb.__corneropsSql?.end({ timeout: 5 }), globalForDb.__corneropsSystemSql?.end({ timeout: 5 })]);
  globalForDb.__corneropsSql = undefined;
  globalForDb.__corneropsSystemSql = undefined;
}
