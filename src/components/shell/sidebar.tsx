"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useSystemStatus } from "@/hooks/queries";
import { cn } from "@/lib/utils";
import { NAV_GROUPS, type NavBadge } from "./nav";

export function BrandMark({ className }: { className?: string }) {
  return (
    <div className={cn("flex items-center gap-2.5", className)}>
      <svg viewBox="0 0 32 32" className="size-7 shrink-0" aria-hidden>
        <rect width="32" height="32" rx="7" fill="#1f1f24" />
        <path d="M9 9h8v4h-4v10H9z" fill="#fafaf9" />
        <path d="M19 15h4v8h-8v-4h4z" fill="#eb6834" />
      </svg>
      <div className="leading-none">
        <div className="text-[13px] font-bold tracking-[0.14em]">CORNEROPS</div>
        <div className="mt-1 text-[11px] font-medium text-muted-foreground">Restaurant OS</div>
      </div>
    </div>
  );
}

export function SidebarNav({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  const { data: status } = useSystemStatus();
  const badgeValue = (b?: NavBadge) =>
    !b || !status ? 0 : b === "activeOrders" ? status.activeOrders : b === "newOrders" ? status.newOrders : status.alertCount;

  return (
    <nav className="flex flex-col gap-5 px-3" aria-label="Main">
      {NAV_GROUPS.map((group) => (
        <div key={group.label}>
          <div className="mb-1 px-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground/80">{group.label}</div>
          <ul className="space-y-0.5">
            {group.items.map((item) => {
              const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
              const count = badgeValue(item.badge);
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    onClick={onNavigate}
                    aria-current={active ? "page" : undefined}
                    className={cn(
                      "group flex h-8 items-center gap-2.5 rounded-md px-2 text-[13px] font-medium text-sidebar-foreground/80 transition-colors hover:bg-sidebar-accent hover:text-sidebar-foreground",
                      active && "bg-sidebar-accent text-sidebar-foreground shadow-[inset_0_0_0_1px_rgba(0,0,0,0.04)]",
                    )}
                  >
                    <item.icon className={cn("size-4 text-muted-foreground group-hover:text-foreground", active && "text-foreground")} />
                    <span className="flex-1 truncate">{item.label}</span>
                    {count > 0 ? (
                      <span
                        className={cn(
                          "min-w-5 rounded-full px-1.5 text-center text-[10px] font-semibold leading-5 tabular",
                          item.badge === "newOrders" ? "bg-blue-600 text-white" : "bg-foreground/[0.07] text-foreground/80",
                        )}
                      >
                        {count}
                      </span>
                    ) : null}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
}

export function Sidebar() {
  const { data: status } = useSystemStatus();
  return (
    <aside className="sticky top-0 hidden h-dvh w-60 shrink-0 flex-col border-r bg-sidebar lg:flex">
      <div className="flex h-14 items-center px-5">
        <Link href="/overview" aria-label="CornerOps home">
          <BrandMark />
        </Link>
      </div>
      <div className="flex-1 overflow-y-auto py-3 scrollbar-thin">
        <SidebarNav />
      </div>
      <div className="border-t px-5 py-3 text-[11px] leading-relaxed text-muted-foreground">
        <div className="font-medium text-foreground/80">Casa Norte Mexican Kitchen</div>
        <div>3 locations · AED · Asia/Dubai</div>
        {status?.demo.enabled ? <div className="mt-1 text-amber-700">Simulated integrations</div> : null}
      </div>
    </aside>
  );
}
