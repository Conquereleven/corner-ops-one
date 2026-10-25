import type { Metadata } from "next";
import { AuthShell } from "../login/auth-shell";
import { SignUpForm } from "../login/auth-forms";

export const metadata: Metadata = { title: "Create account" };

export default function SignUpPage() {
  return (
    <AuthShell>
      <SignUpForm />
    </AuthShell>
  );
}
