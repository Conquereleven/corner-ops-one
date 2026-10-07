import type { OrderChannel } from "@/domain/channels/types";
import { CHANNEL_THEME } from "@/lib/channel-theme";
import { cn } from "@/lib/utils";

/** Colored monogram tile — channel identity is carried by the letters, not color alone. */
export function ChannelMark({ channel, size = "sm", className }: { channel: OrderChannel; size?: "xs" | "sm" | "md" | "lg"; className?: string }) {
  const t = CHANNEL_THEME[channel];
  const dims = { xs: "size-4 text-[8px] rounded-[3px]", sm: "size-5 text-[9px] rounded", md: "size-7 text-[11px] rounded-md", lg: "size-10 text-sm rounded-lg" }[size];
  return (
    <span
      aria-hidden
      className={cn("inline-flex shrink-0 items-center justify-center font-semibold tracking-tight text-white", dims, className)}
      style={{ backgroundColor: t.color }}
    >
      {t.monogram}
    </span>
  );
}

export function ChannelBadge({ channel, short, className, size = "sm" }: { channel: OrderChannel; short?: boolean; className?: string; size?: "xs" | "sm" | "md" }) {
  const t = CHANNEL_THEME[channel];
  return (
    <span className={cn("inline-flex items-center gap-1.5 whitespace-nowrap font-medium", className)}>
      <ChannelMark channel={channel} size={size} />
      <span>{short ? t.short : t.label}</span>
    </span>
  );
}
