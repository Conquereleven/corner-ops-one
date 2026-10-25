import { cookies } from "next/headers";
import { getSessionUser, ORG_COOKIE } from "@/server/context/request";
import { UnauthenticatedError } from "@/server/errors";
import { handle, parseBody } from "@/server/http";
import { createOrganization, createOrganizationSchema } from "@/server/services/onboarding";

/** Onboarding: create an organization owned by the signed-in user. */
export const POST = handle(async (req: Request) => {
  const user = await getSessionUser();
  if (!user) throw new UnauthenticatedError();
  const input = await parseBody(req, createOrganizationSchema);
  const org = await createOrganization(user, input);
  (await cookies()).set(ORG_COOKIE, org.id, { path: "/", sameSite: "lax", httpOnly: true, maxAge: 60 * 60 * 24 * 180 });
  return org;
});
