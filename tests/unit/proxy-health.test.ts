import { NextRequest } from "next/server";
import { afterEach, describe, expect, it } from "vitest";
import { proxy } from "@/proxy";

const saved = { ...process.env };
afterEach(() => {
  process.env = { ...saved };
});

describe("health probes and the auth proxy", () => {
  it("liveness and readiness are reachable when Supabase Auth configuration is incomplete", async () => {
    process.env.AUTH_PROVIDER = "supabase";
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    delete process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
    for (const path of ["/api/health/live", "/api/health/ready", "/api/health"]) {
      const res = await proxy(new NextRequest(`http://localhost${path}`));
      expect(res.status).toBe(200);
      expect(res.headers.get("location")).toBeNull();
    }
  });

  it("other API routes still require a session", async () => {
    process.env.AUTH_PROVIDER = "local";
    const res = await proxy(new NextRequest("http://localhost/api/orders"));
    expect(res.status).toBe(401);
  });

  it("look-alike paths are not exempt", async () => {
    process.env.AUTH_PROVIDER = "local";
    const res = await proxy(new NextRequest("http://localhost/api/healthz-admin"));
    expect(res.status).toBe(401);
  });
});
