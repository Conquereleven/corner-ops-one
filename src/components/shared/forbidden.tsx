import { ShieldAlert } from "lucide-react";
import Link from "next/link";

export function Forbidden({ message }: { message?: string }) {
  return (
    <div className="mx-auto mt-16 flex max-w-md flex-col items-center gap-2 rounded-xl border border-dashed px-6 py-12 text-center">
      <ShieldAlert className="size-6 text-muted-foreground" aria-hidden />
      <h1 className="text-base font-semibold">You don&apos;t have access to this page</h1>
      <p className="text-sm text-muted-foreground">{message ?? "Your role doesn't include this area."} Ask an owner or admin if you need access.</p>
      <Link href="/" className="mt-2 text-sm font-medium underline underline-offset-2">
        Go to your home screen
      </Link>
    </div>
  );
}
