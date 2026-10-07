import {
  Boxes,
  Cable,
  ChartColumn,
  ChefHat,
  Coins,
  LayoutDashboard,
  MapPin,
  ReceiptText,
  Settings,
  Sparkles,
  UtensilsCrossed,
} from "lucide-react";

export type NavBadge = "activeOrders" | "newOrders" | "alerts";

export interface NavItem {
  href: string;
  label: string;
  icon: typeof LayoutDashboard;
  badge?: NavBadge;
}

export const NAV_GROUPS: { label: string; items: NavItem[] }[] = [
  {
    label: "Operate",
    items: [
      { href: "/overview", label: "Overview", icon: LayoutDashboard },
      { href: "/orders", label: "Live Orders", icon: ReceiptText, badge: "activeOrders" },
      { href: "/kitchen", label: "Kitchen", icon: ChefHat, badge: "newOrders" },
    ],
  },
  {
    label: "Catalog",
    items: [
      { href: "/menu", label: "Menu", icon: UtensilsCrossed },
      { href: "/inventory", label: "Inventory", icon: Boxes },
    ],
  },
  {
    label: "Performance",
    items: [
      { href: "/channels", label: "Channels", icon: Cable },
      { href: "/analytics", label: "Analytics", icon: ChartColumn },
      { href: "/profitability", label: "Profitability", icon: Coins },
      { href: "/ai", label: "AI Operations", icon: Sparkles },
    ],
  },
  {
    label: "Organization",
    items: [
      { href: "/locations", label: "Locations", icon: MapPin },
      { href: "/settings", label: "Settings", icon: Settings },
    ],
  },
];
