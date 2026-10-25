import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { currentIdentity, getSessionUser } from "@/server/context/request";
import { NoOrganizationError, UnauthenticatedError } from "@/server/errors";
import { AuthShell } from "../login/auth-shell";
import { OnboardingForm } from "../login/auth-forms";

export const metadata: Metadata = { title: "Set up your organization" };

export default async function OnboardingPage() {
  const user = await getSessionUser();
  if (!user) redirect("/api/auth/expired");
  let hasOrg = true;
  let stale = false;
  try {
    await currentIdentity();
  } catch (err) {
    if (err instanceof NoOrganizationError) hasOrg = false;
    else if (err instanceof UnauthenticatedError) stale = true;
    else throw err;
  }
  if (stale) redirect("/api/auth/expired");
  if (hasOrg) redirect("/");
  return (
    <AuthShell>
      <OnboardingForm email={user.email} />
    </AuthShell>
  );
}
