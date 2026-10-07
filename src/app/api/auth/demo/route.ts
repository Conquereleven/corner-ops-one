import { cookies } from "next/headers";
import { ORG_ID } from "@/server/seed/catalog";
import { createSessionToken, SESSION_COOKIE, SESSION_TTL_SECONDS } from "@/server/auth/session";
import { DEMO_USER_ID } from "@/server/services/context";

/** Demo access: issues a signed session for the demo owner account. No passwords in v0.1. */
export async function POST() {
  const token = await createSessionToken({ userId: DEMO_USER_ID, organizationId: ORG_ID });
  (await cookies()).set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_TTL_SECONDS,
  });
  return Response.json({ ok: true });
}
