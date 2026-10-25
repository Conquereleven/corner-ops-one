import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import postgres from "postgres";
import { migrate } from "../../scripts/db/migrate";

/**
 * Recreate the test database from migrations and seed two tenants:
 *   - the Demo Workspace (org_cornerops_demo, is_demo)
 *   - "Casa Norte Hospitality LLC" (org_casanorte_hosp, production-like)
 */
export default async function setup() {
  const url = process.env.TEST_DATABASE_URL ?? "postgres://postgres@127.0.0.1:54329/cornerops_test";
  const admin = url.replace(/\/[^/]+$/, "/postgres");
  const dbName = url.split("/").pop()!;
  if (!process.env.TEST_DATABASE_URL) {
    execFileSync(resolve(__dirname, "../../scripts/db/local.sh"), ["start"], { stdio: "ignore" });
  }
  const sql = postgres(admin, { max: 1, onnotice: () => {} });
  await sql.unsafe(`drop database if exists ${dbName} with (force)`);
  await sql.unsafe(`create database ${dbName}`);
  await sql.end();
  await migrate(url, { localEmulation: true, log: () => {} });

  process.env.DATABASE_URL = url;
  process.env.APP_MODE = "demo";
  process.env.APP_ENV = "test";
  process.env.AUTH_PROVIDER = "local";
  process.env.DEMO_AUTO_REFRESH = "off";
  const { seedFixtures } = await import("./fixtures");
  await seedFixtures();
  const { closeSql } = await import("../../src/server/db/client");
  await closeSql();
}
