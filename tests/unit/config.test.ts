import { afterEach, describe, expect, it } from "vitest";
import { appMode, authProviderName } from "@/server/config";

const saved = { ...process.env };
afterEach(() => {
  process.env = { ...saved };
});

describe("runtime configuration guards", () => {
  it("refuses the local auth stand-in in staging and production", () => {
    process.env.AUTH_PROVIDER = "local";
    process.env.APP_ENV = "production";
    expect(() => authProviderName()).toThrow(/not allowed/);
    process.env.APP_ENV = "staging";
    expect(() => authProviderName()).toThrow(/not allowed/);
    process.env.APP_ENV = "development";
    expect(authProviderName()).toBe("local");
  });

  it("defaults to production mode in production and rejects unknown modes", () => {
    delete process.env.APP_MODE;
    process.env.APP_ENV = "production";
    expect(appMode()).toBe("production");
    process.env.APP_MODE = "sandbox";
    expect(() => appMode()).toThrow();
  });
});
