import { assertDisposableTestDatabase } from "./db-safety";

// Integration workers run destructive operations too (e.g. demo reset), so they
// re-assert the disposable-database guard before configuring the connection.
const target = assertDisposableTestDatabase(process.env.TEST_DATABASE_URL ?? "postgres://postgres@127.0.0.1:54329/cornerops_test");
process.env.DATABASE_URL = target.url;
process.env.APP_MODE = "demo";
process.env.APP_ENV = "test";
process.env.AUTH_PROVIDER = "local";
process.env.SESSION_SECRET ??= "test-secret-test-secret-test-secret-0123456789";
process.env.DEMO_AUTO_REFRESH = "off";
