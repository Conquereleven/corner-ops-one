import type { OrderChannel } from "@/domain/channels/types";

/** Channel identity for UI: color (validated categorical palette) + monogram, so identity never relies on color alone. */
export const CHANNEL_THEME: Record<OrderChannel, { color: string; monogram: string; label: string; short: string }> = {
  talabat: { color: "var(--ch-talabat)", monogram: "T", label: "Talabat", short: "Talabat" },
  deliveroo: { color: "var(--ch-deliveroo)", monogram: "D", label: "Deliveroo", short: "Deliveroo" },
  noon: { color: "var(--ch-noon)", monogram: "N", label: "Noon Food", short: "Noon" },
  keeta: { color: "var(--ch-keeta)", monogram: "K", label: "Keeta", short: "Keeta" },
  direct: { color: "var(--ch-direct)", monogram: "W", label: "Direct Website", short: "Direct" },
  whatsapp: { color: "var(--ch-whatsapp)", monogram: "WA", label: "WhatsApp", short: "WhatsApp" },
};

/** Raw hex for chart libraries that can't resolve CSS variables in all places. */
export const CHANNEL_HEX: Record<OrderChannel, string> = {
  talabat: "#eb6834",
  deliveroo: "#1baf7a",
  noon: "#eda100",
  keeta: "#4a3aa7",
  direct: "#2a78d6",
  whatsapp: "#008300",
};
