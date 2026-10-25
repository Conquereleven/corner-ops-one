import { ConfigurationError } from "./errors";

/**
 * Runtime configuration. See .env.example for the full inventory.
 *
 *   APP_MODE      demo | production   — demo enables the Demo Workspace entry and simulator
 *   APP_ENV       development | test | staging | production
 *   AUTH_PROVIDER supabase | local    — local is a development-only stand-in for Supabase Auth
 */
export type AppMode = "demo" | "production";
export type AuthProviderName = "supabase" | "local";

export function appEnv(): "development" | "test" | "staging" | "production" {
  const v = process.env.APP_ENV ?? (process.env.NODE_ENV === "production" ? "production" : "development");
  return (["development", "test", "staging", "production"].includes(v) ? v : "development") as ReturnType<typeof appEnv>;
}

export function appMode(): AppMode {
  const v = process.env.APP_MODE ?? (appEnv() === "production" ? "production" : "demo");
  if (v !== "demo" && v !== "production") throw new ConfigurationError(`APP_MODE must be "demo" or "production" (got "${v}")`);
  return v;
}

export function authProviderName(): AuthProviderName {
  const v = (process.env.AUTH_PROVIDER ?? (process.env.NEXT_PUBLIC_SUPABASE_URL ? "supabase" : "local")) as AuthProviderName;
  if (v !== "supabase" && v !== "local") throw new ConfigurationError(`AUTH_PROVIDER must be "supabase" or "local"`);
  if (v === "local" && (appEnv() === "production" || appEnv() === "staging")) {
    throw new ConfigurationError("AUTH_PROVIDER=local is a development stand-in and is not allowed in staging/production.");
  }
  return v;
}

export function demoConfig() {
  return {
    email: (process.env.DEMO_USER_EMAIL ?? "demo@cornerops.one").toLowerCase(),
    password: process.env.DEMO_USER_PASSWORD ?? "",
    /** daily: regenerate the demo workspace the first time it is entered on a new (Dubai) day. */
    autoRefresh: (process.env.DEMO_AUTO_REFRESH ?? "daily") as "daily" | "off",
  };
}
