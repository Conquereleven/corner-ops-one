import { cookies } from "next/headers";
import { z } from "zod";
import { currentIdentity, LOCATION_COOKIE, ORG_COOKIE } from "@/server/context/request";
import { ForbiddenError } from "@/server/errors";
import { handle, parseBody } from "@/server/http";

/** Switch the active organization (must be one of the user's active memberships). */
export const POST = handle(async (req: Request) => {
  const { organizationId } = await parseBody(req, z.object({ organizationId: z.string().min(1).max(64) }));
  const identity = await currentIdentity();
  if (!identity.memberships.some((m) => m.organizationId === organizationId)) throw new ForbiddenError("You are not a member of that organization.");
  const store = await cookies();
  store.set(ORG_COOKIE, organizationId, { path: "/", sameSite: "lax", httpOnly: true, maxAge: 60 * 60 * 24 * 180 });
  store.delete(LOCATION_COOKIE);
  return { ok: true };
});
