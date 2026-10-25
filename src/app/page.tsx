import { redirect } from "next/navigation";
import { homePathFor } from "@/domain/auth/permissions";
import { currentIdentity } from "@/server/context/request";
import { NoOrganizationError, UnauthenticatedError } from "@/server/errors";

/** Send each role to its home screen (kitchen staff → Kitchen). */
export default async function Home() {
  let target = "/api/auth/expired";
  try {
    const identity = await currentIdentity();
    target = homePathFor(identity.membership.role);
  } catch (err) {
    if (err instanceof NoOrganizationError) target = "/onboarding";
    else if (!(err instanceof UnauthenticatedError)) throw err;
  }
  redirect(target);
}
