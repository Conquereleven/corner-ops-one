import { cookies } from "next/headers";
import { getAuthProvider } from "@/server/auth";
import { ORG_COOKIE } from "@/server/context/request";
import { handle } from "@/server/http";

export const POST = handle(async () => {
  await getAuthProvider().signOut();
  (await cookies()).delete(ORG_COOKIE);
  return { ok: true };
});
