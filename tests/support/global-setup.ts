import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { assertDisposableTestDatabase, verifyDisposableServer } from "./db-safety";

const DEFAULT_LOCAL_URL = "postgres://postgres@127.0.0.1:54329/cornerops_test";

/**
 * Integration-suite setup: recreate a DISPOSABLE local test database from
 * migrations and seed two tenants (Demo Workspace + a production-like tenant).
 * The safety guard runs before any connection or SQL.
 */
export default async function setup() {
  let target;
  try {
    target = assertDisposableTestDatabase(process.env.TEST_DATABASE_URL ?? DEFAULT_LOCAL_URL);
  } catch (err) {
    process.stderr.write(`\n[cornerops] ${(err as Error).message}\n\n`);
    throw err;
  }

  if (!process.env.TEST_DATABASE_URL) {
    execFileSync(resolve(__dirname, "../../scripts/db/local.sh"), ["start"], { stdio: "ignore" });
  }
  const { default: postgres } = await import("postgres");
  const { migrate } = await import("../../scripts/db/migrate");
  const admin = postgres(target.adminUrl, { max: 1, onnotice: () => {} });
  try {
    // The server itself must prove it is disposable before anything is dropped.
    try {
      await verifyDisposableServer(admin as never);
    } catch (err) {
      process.stderr.write(`\n[cornerops] ${(err as Error).message}\n\n`);
      throw err;
    }
    await admin.unsafe(`drop database if exists ${target.quotedDatabase} with (force)`);
    await admin.unsafe(`create database ${target.quotedDatabase}`);
  } finally {
    await admin.end();
  }
  await migrate(target.url, { localEmulation: true, log: () => {} });

  process.env.DATABASE_URL = target.url;
  process.env.APP_MODE = "demo";
  process.env.APP_ENV = "test";
  process.env.AUTH_PROVIDER = "local";
  process.env.DEMO_AUTO_REFRESH = "off";
  const { seedFixtures } = await import("./fixtures");
  await seedFixtures();
  const { closeSql } = await import("../../src/server/db/client");
  await closeSql();
}
