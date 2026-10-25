import { ChannelMark } from "@/components/shared/channel-badge";
import { BrandMark } from "@/components/shell/sidebar";
import { ORDER_CHANNELS } from "@/domain/channels/types";

/** Split layout shared by sign-in, sign-up and onboarding. */
export function AuthShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid min-h-dvh lg:grid-cols-[1.1fr_1fr]">
      <div className="relative hidden flex-col justify-between overflow-hidden bg-[#141417] p-10 text-white lg:flex">
        <BrandMark className="[&_.text-muted-foreground]:text-white/50" />
        <div className="max-w-lg">
          <p className="text-sm font-medium text-white/50">One operation. Every channel.</p>
          <h1 className="mt-3 text-4xl font-semibold leading-tight tracking-tight">The operating layer for multi-channel restaurants.</h1>
          <p className="mt-4 text-[15px] leading-relaxed text-white/60">
            Talabat, Deliveroo, Noon Food, Keeta, your website and WhatsApp in one order queue, one kitchen board and one view of what every channel earns.
          </p>
          <div className="mt-8 flex items-center gap-2">
            {ORDER_CHANNELS.map((c) => (
              <ChannelMark key={c} channel={c} size="md" />
            ))}
          </div>
        </div>
        <div className="text-xs text-white/30">CornerOps One · a CornerTech AI product</div>
      </div>
      <div className="flex items-center justify-center p-6">
        <div className="w-full max-w-sm">
          <div className="mb-8 lg:hidden">
            <BrandMark />
          </div>
          {children}
        </div>
      </div>
    </div>
  );
}
