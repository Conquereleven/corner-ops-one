import { describe, expect, it } from "vitest";
import { assignableRoles, can, isLocationRestricted, ROLES } from "@/domain/auth/permissions";
import { applyTransition, availableActions, blockedByShortfall } from "@/domain/orders/state-machine";
import type { UnifiedOrder } from "@/domain/orders/types";
import { redact } from "@/server/repositories/audit";
import { resolveScope } from "@/server/context/app-context";

const locs = ["a", "b", "c"].map((id) => ({ id, name: id.toUpperCase() })) as never[];

describe("permissions", () => {
  it("only owners can assign OWNER", () => {
    expect(assignableRoles("OWNER")).toContain("OWNER");
    expect(assignableRoles("ADMIN")).not.toContain("OWNER");
    expect(assignableRoles("BRANCH_MANAGER")).toEqual([]);
  });
  it("location restriction applies to branch and kitchen roles only", () => {
    expect(ROLES.filter(isLocationRestricted)).toEqual(["BRANCH_MANAGER", "KITCHEN_STAFF"]);
  });
  it("demo workspace never allows team or organization management", () => {
    expect(can("ADMIN", "team.manage", { isDemo: true })).toBe(false);
    expect(can("ADMIN", "demo.manage", { isDemo: false })).toBe(false);
  });
});

describe("scope resolution", () => {
  it("'all' means every allowed location; unknown locations fall back or are rejected", () => {
    expect(resolveScope(locs, "all").locationIds).toEqual(["a", "b", "c"]);
    expect(resolveScope(locs, "b").locationIds).toEqual(["b"]);
    expect(resolveScope(locs, "zzz").key).toBe("all");
    expect(() => resolveScope(locs, "zzz", { strict: true })).toThrow();
  });
});

describe("order state machine", () => {
  const order = { status: "new", fulfillment: "delivery", items: [], metadata: {} } as unknown as UnifiedOrder;
  it("applies lifecycle timestamps", () => {
    const accepted = applyTransition(order, "accept", "2026-10-25T10:00:00.000Z");
    expect(accepted.status).toBe("accepted");
    expect(accepted.acceptedAt).toBe("2026-10-25T10:00:00.000Z");
    expect(availableActions(accepted)).toContain("start_preparing");
  });
  it("rejects invalid transitions", () => {
    expect(() => applyTransition(order, "mark_picked_up", "x")).toThrow();
  });
  it("an open inventory shortfall blocks ready / picked up / complete (also for the simulator), not preparation or cancellation", () => {
    const short = { ...order, status: "preparing", inventoryShortfall: "open" } as UnifiedOrder;
    expect(availableActions(short)).toEqual(["cancel"]);
    expect(blockedByShortfall(short, "mark_ready")).toBe(true);
    expect(blockedByShortfall(short, "start_preparing")).toBe(false);
    expect(availableActions({ ...short, inventoryShortfall: "resolved" })).toContain("mark_ready");
  });
});

describe("audit redaction", () => {
  it("never stores secrets in metadata", () => {
    expect(redact({ apiKey: "sk", nested: { password: "p", ok: 1 }, credential_reference: "vault://x" })).toEqual({
      apiKey: "[redacted]",
      nested: { password: "[redacted]", ok: 1 },
      credential_reference: "[redacted]",
    });
  });
});
