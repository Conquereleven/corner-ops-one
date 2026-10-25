"use client";

import { ArrowRight, FlaskConical, Loader2 } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

async function post(url: string, body?: unknown) {
  const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body ?? {}) });
  const data = (await res.json().catch(() => ({}))) as { error?: string; issues?: { message: string }[]; confirmationRequired?: boolean };
  if (!res.ok) throw new Error(data.issues?.[0]?.message ?? data.error ?? "Something went wrong");
  return data;
}

function safeNext(next: string | null) {
  return next && next.startsWith("/") && !next.startsWith("//") ? next : "/";
}

export function SignInForm({ demoEnabled }: { demoEnabled: boolean }) {
  const router = useRouter();
  const params = useSearchParams();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [pending, setPending] = useState<"password" | "demo" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const go = async (kind: "password" | "demo") => {
    setPending(kind);
    setError(null);
    try {
      if (kind === "password") await post("/api/auth/login", { email, password });
      else await post("/api/auth/demo");
      router.replace(kind === "demo" ? "/overview" : safeNext(params.get("next")));
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
      setPending(null);
    }
  };

  return (
    <div>
      <h2 className="text-xl font-semibold tracking-tight">Sign in to CornerOps One</h2>
      <p className="mt-1 text-sm text-muted-foreground">Use your work email and password.</p>
      {params.get("expired") ? (
        <p className="mt-3 rounded-md bg-muted px-3 py-2 text-xs text-muted-foreground">Your session ended. Please sign in again.</p>
      ) : null}
      <form
        className="mt-6 space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          go("password");
        }}
      >
        <label className="block space-y-1 text-sm">
          <span className="text-xs text-muted-foreground">Email</span>
          <Input type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} className="h-10" />
        </label>
        <label className="block space-y-1 text-sm">
          <span className="text-xs text-muted-foreground">Password</span>
          <Input type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} className="h-10" />
        </label>
        {error ? <p className="text-xs text-red-600" role="alert">{error}</p> : null}
        <Button type="submit" className="h-10 w-full" disabled={!!pending}>
          {pending === "password" ? <Loader2 className="animate-spin" /> : null}
          Sign in
        </Button>
      </form>
      <p className="mt-4 text-center text-sm text-muted-foreground">
        New to CornerOps One?{" "}
        <Link href="/signup" className="font-medium text-foreground underline underline-offset-2">
          Create an account
        </Link>
      </p>
      {demoEnabled ? (
        <div className="mt-8 rounded-xl border border-amber-200 bg-amber-50/60 p-4">
          <div className="flex items-center gap-2 text-sm font-medium text-amber-900">
            <FlaskConical className="size-4" /> Demo Workspace
          </div>
          <p className="mt-1 text-xs text-amber-900/80">
            Explore Casa Norte Mexican Kitchen with simulated orders from every channel. No account needed; isolated from customer data.
          </p>
          <Button variant="outline" className="mt-3 h-9 w-full bg-card" onClick={() => go("demo")} disabled={!!pending}>
            {pending === "demo" ? <Loader2 className="animate-spin" /> : null}
            Enter Demo Workspace
            {pending !== "demo" ? <ArrowRight /> : null}
          </Button>
        </div>
      ) : null}
    </div>
  );
}

export function SignUpForm() {
  const router = useRouter();
  const [form, setForm] = useState({ fullName: "", email: "", password: "" });
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState(false);

  const submit = async () => {
    setPending(true);
    setError(null);
    try {
      const res = await post("/api/auth/signup", form);
      if (res.confirmationRequired) {
        setConfirm(true);
        setPending(false);
        return;
      }
      router.replace("/");
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
      setPending(false);
    }
  };

  if (confirm) {
    return (
      <div>
        <h2 className="text-xl font-semibold tracking-tight">Check your email</h2>
        <p className="mt-2 text-sm text-muted-foreground">We sent a confirmation link to {form.email}. Confirm it, then sign in.</p>
      </div>
    );
  }
  return (
    <div>
      <h2 className="text-xl font-semibold tracking-tight">Create your account</h2>
      <p className="mt-1 text-sm text-muted-foreground">If your team invited you, use the email they invited.</p>
      <form
        className="mt-6 space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        {(
          [
            ["fullName", "Full name", "text", "name"],
            ["email", "Work email", "email", "email"],
            ["password", "Password (10+ characters)", "password", "new-password"],
          ] as const
        ).map(([key, label, type, auto]) => (
          <label key={key} className="block space-y-1 text-sm">
            <span className="text-xs text-muted-foreground">{label}</span>
            <Input type={type} autoComplete={auto} required value={form[key]} onChange={(e) => setForm({ ...form, [key]: e.target.value })} className="h-10" />
          </label>
        ))}
        {error ? <p className="text-xs text-red-600" role="alert">{error}</p> : null}
        <Button type="submit" className="h-10 w-full" disabled={pending}>
          {pending ? <Loader2 className="animate-spin" /> : null}
          Create account
        </Button>
      </form>
      <p className="mt-4 text-center text-sm text-muted-foreground">
        Already have an account?{" "}
        <Link href="/login" className="font-medium text-foreground underline underline-offset-2">
          Sign in
        </Link>
      </p>
    </div>
  );
}

export function OnboardingForm({ email }: { email: string }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async () => {
    setPending(true);
    setError(null);
    try {
      await post("/api/organizations", { name });
      router.replace("/settings");
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
      setPending(false);
    }
  };
  return (
    <div>
      <h2 className="text-xl font-semibold tracking-tight">Set up your organization</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        Signed in as {email}. You&apos;ll be the owner. If you expected an invitation, ask your team to invite this email.
      </p>
      <form
        className="mt-6 space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <label className="block space-y-1 text-sm">
          <span className="text-xs text-muted-foreground">Organization name</span>
          <Input required minLength={2} value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Casa Norte Hospitality LLC" className="h-10" />
        </label>
        {error ? <p className="text-xs text-red-600" role="alert">{error}</p> : null}
        <Button type="submit" className="h-10 w-full" disabled={pending || name.trim().length < 2}>
          {pending ? <Loader2 className="animate-spin" /> : null}
          Create organization
        </Button>
      </form>
      <button
        type="button"
        className="mt-4 w-full text-center text-xs text-muted-foreground underline underline-offset-2"
        onClick={async () => {
          await fetch("/api/auth/logout", { method: "POST" });
          router.replace("/login");
        }}
      >
        Sign out
      </button>
    </div>
  );
}
