import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { getAuthProvider } from "@/server/auth";
import { ORG_COOKIE } from "@/server/context/request";

/**
 * The session cookie was present but no longer maps to a valid user (expired,
 * revoked or deleted). Clear it and send the user to sign in — this prevents a
 * redirect loop between the proxy and the application.
 */
export async function GET(request: Request) {
  await getAuthProvider().signOut().catch(() => {});
  (await cookies()).delete(ORG_COOKIE);
  return NextResponse.redirect(new URL("/login?expired=1", request.url));
}
