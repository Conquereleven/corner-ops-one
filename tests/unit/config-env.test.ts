import { afterEach, describe, expect, it } from "vitest";
import { appEnv } from "@/server/config";

const saved = { ...process.env };
afterEach(() => {
  process.env = { ...saved };
});

describe("APP_ENV", () => {
  it("rejects unknown values instead of falling back to development", () => {
    process.env.APP_ENV = "prodution";
    expect(() => appEnv()).toThrow(/APP_ENV/);
  });
  it("accepts known values", () => {
    for (const v of ["development", "test", "staging", "production"]) {
      process.env.APP_ENV = v;
      expect(appEnv()).toBe(v);
    }
  });
});
