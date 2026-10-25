import { cookies } from "next/headers";
import { getAuthProvider } from "@/server/auth";
import { setLocalSessionCookie } from "@/server/auth/local-provider";
import { authProviderName, demoConfig } from "@/server/config";
import { ORG_COOKIE } from "@/server/context/request";
import { DEMO_ORGANIZATION_ID, ensureDemoWorkspace } from "@/server/demo/workspace";
import { ConfigurationError } from "@/server/errors";
import { handle } from "@/server/http";

/**
 * Enter the Demo Workspace (APP_MODE=demo only). Signs in as the shared demo
 * user — a normal authenticated user whose only membership is the isolated
 * demo organization. No customer account is created.
 */
export const POST = handle(async () => {
  const { userId } = await ensureDemoWorkspace();
  const { email, password } = demoConfig();
  if (authProviderName() === "local") {
    await setLocalSessionCookie({ id: userId, email, name: "Demo Operator" });
  } else {
    if (!password) throw new ConfigurationError("DEMO_USER_PASSWORD is required to enter the Demo Workspace with Supabase Auth.");
    await getAuthProvider().signInWithPassword(email, password);
  }
  (await cookies()).set(ORG_COOKIE, DEMO_ORGANIZATION_ID, { path: "/", sameSite: "lax", httpOnly: true, maxAge: 60 * 60 * 24 * 180 });
  return { ok: true };
});
