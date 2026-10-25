import postgres from "postgres";
import { ConfigurationError } from "../errors";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Sql = postgres.Sql<any>;
/** A connection or transaction handle. Repositories accept either. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Db = postgres.Sql<any> | postgres.TransactionSql<any>;

const toIso = (v: unknown) => (v instanceof Date ? v.toISOString() : v);

function createClient(url: string): Sql {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return postgres<any>(url, {
    max: Number(process.env.DATABASE_POOL_MAX ?? 10),
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

const globalForDb = globalThis as unknown as { __corneropsSql?: Sql; __corneropsSqlUrl?: string };

export function databaseUrl(): string {
  const url = process.env.DATABASE_URL;
  if (!url) throw new ConfigurationError("DATABASE_URL is not configured. See .env.example.");
  return url;
}

/** Process-wide connection pool. */
export function getSql(): Sql {
  const url = databaseUrl();
  if (!globalForDb.__corneropsSql || globalForDb.__corneropsSqlUrl !== url) {
    globalForDb.__corneropsSql = createClient(url);
    globalForDb.__corneropsSqlUrl = url;
  }
  return globalForDb.__corneropsSql;
}

export async function closeSql() {
  await globalForDb.__corneropsSql?.end({ timeout: 5 });
  globalForDb.__corneropsSql = undefined;
}
