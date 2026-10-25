// Test runtime configuration (local Postgres, local auth stand-in, demo mode).
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? "postgres://postgres@127.0.0.1:54329/cornerops_test";
process.env.APP_MODE = "demo";
process.env.APP_ENV = "test";
process.env.AUTH_PROVIDER = "local";
process.env.SESSION_SECRET ??= "test-secret-test-secret-test-secret-0123456789";
process.env.DEMO_AUTO_REFRESH = "off";
