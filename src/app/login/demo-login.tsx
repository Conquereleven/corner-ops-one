"use client";

import { ArrowRight, Loader2 } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";

export function DemoLogin() {
  const router = useRouter();
  const params = useSearchParams();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const enter = async () => {
    setPending(true);
    setError(null);
    const res = await fetch("/api/auth/demo", { method: "POST" });
    if (!res.ok) {
      setPending(false);
      setError("Could not start a demo session. Check SESSION_SECRET in .env.local.");
      return;
    }
    const next = params.get("next");
    router.replace(next && next.startsWith("/") && !next.startsWith("//") ? next : "/overview");
    router.refresh();
  };

  return (
    <div className="mt-4">
      <Button className="h-10 w-full" onClick={enter} disabled={pending}>
        {pending ? <Loader2 className="animate-spin" /> : null}
        Enter demo workspace
        {!pending ? <ArrowRight /> : null}
      </Button>
      {error ? <p className="mt-2 text-xs text-red-600">{error}</p> : null}
    </div>
  );
}
