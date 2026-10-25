import type { Metadata } from "next";
import { Suspense } from "react";
import { appMode } from "@/server/config";
import { AuthShell } from "./auth-shell";
import { SignInForm } from "./auth-forms";

export const metadata: Metadata = { title: "Sign in" };

export default function LoginPage() {
  return (
    <AuthShell>
      <Suspense>
        <SignInForm demoEnabled={appMode() === "demo"} />
      </Suspense>
    </AuthShell>
  );
}
