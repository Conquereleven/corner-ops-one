import type { Metadata } from "next";
import { Suspense } from "react";
import { ChannelMark } from "@/components/shared/channel-badge";
import { BrandMark } from "@/components/shell/sidebar";
import { ORDER_CHANNELS } from "@/domain/channels/types";
import { DemoLogin } from "./demo-login";

export const metadata: Metadata = { title: "Sign in" };

export default function LoginPage() {
  return (
    <div className="grid min-h-dvh lg:grid-cols-[1.1fr_1fr]">
      <div className="relative hidden flex-col justify-between overflow-hidden bg-[#141417] p-10 text-white lg:flex">
        <div className="[&_div]:text-white">
          <BrandMark className="[&_.text-muted-foreground]:text-white/50" />
        </div>
        <div className="max-w-lg">
          <p className="text-sm font-medium text-white/50">One restaurant. Many sales channels. One operating system.</p>
          <h1 className="mt-3 text-4xl font-semibold leading-tight tracking-tight">
            Your entire delivery operation, in one place.
          </h1>
          <p className="mt-4 text-[15px] leading-relaxed text-white/60">
            CornerOps sits above Talabat, Deliveroo, Noon Food, Keeta, your website and WhatsApp — one order queue, one kitchen
            board, one view of what every channel actually earns.
          </p>
          <div className="mt-8 flex items-center gap-2">
            {ORDER_CHANNELS.map((c) => (
              <ChannelMark key={c} channel={c} size="md" />
            ))}
            <span className="ml-2 text-xs text-white/40">→ one UnifiedOrder</span>
          </div>
        </div>
        <div className="text-xs text-white/30">Built for multi-location operators in the UAE · AED · Asia/Dubai</div>
      </div>
      <div className="flex items-center justify-center p-6">
        <div className="w-full max-w-sm">
          <div className="mb-8 lg:hidden">
            <BrandMark />
          </div>
          <h2 className="text-xl font-semibold tracking-tight">Welcome back</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Sign in to the <span className="font-medium text-foreground">CornerOps Demo</span> workspace for Casa Norte Mexican Kitchen.
          </p>
          <div className="mt-6 rounded-xl border bg-card p-4">
            <div className="flex items-center gap-3">
              <div className="flex size-9 items-center justify-center rounded-full bg-foreground text-xs font-semibold text-background">LA</div>
              <div className="min-w-0">
                <div className="text-sm font-medium">Layla Al Mansouri</div>
                <div className="text-xs text-muted-foreground">Owner · 3 locations</div>
              </div>
            </div>
            <Suspense>
              <DemoLogin />
            </Suspense>
          </div>
          <p className="mt-4 text-xs leading-relaxed text-muted-foreground">
            Demo access uses simulated channel integrations and generated data. No marketplace credentials are required or stored.
          </p>
        </div>
      </div>
    </div>
  );
}
