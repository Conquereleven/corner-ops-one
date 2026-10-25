import type { Permission } from "@/domain/auth/permissions";
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
  /** Required permission (UI hint; the server enforces it). */
  permission: Permission;
}

export const NAV_GROUPS: { label: string; items: NavItem[] }[] = [
  {
    label: "Operate",
    items: [
      { href: "/overview", label: "Overview", icon: LayoutDashboard, permission: "overview.view" },
      { href: "/orders", label: "Live Orders", icon: ReceiptText, badge: "activeOrders", permission: "orders.view" },
      { href: "/kitchen", label: "Kitchen", icon: ChefHat, badge: "newOrders", permission: "kitchen.view" },
    ],
  },
  {
    label: "Catalog",
    items: [
      { href: "/menu", label: "Menu", icon: UtensilsCrossed, permission: "menu.view" },
      { href: "/inventory", label: "Inventory", icon: Boxes, permission: "inventory.view" },
    ],
  },
  {
    label: "Performance",
    items: [
      { href: "/channels", label: "Channels", icon: Cable, permission: "channels.view" },
      { href: "/analytics", label: "Analytics", icon: ChartColumn, permission: "analytics.view" },
      { href: "/profitability", label: "Profitability", icon: Coins, permission: "profitability.view" },
      { href: "/ai", label: "AI Operations", icon: Sparkles, permission: "ai.view" },
    ],
  },
  {
    label: "Organization",
    items: [
      { href: "/locations", label: "Locations", icon: MapPin, permission: "locations.view" },
      { href: "/settings", label: "Settings", icon: Settings, permission: "settings.view" },
    ],
  },
];
