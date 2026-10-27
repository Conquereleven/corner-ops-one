/**
 * Codex audit 2: event authenticity, permission-change audit, telemetry identity.
 * Direct SQL as realistic roles, bypassing the application.
 */
import { describe, expect, it } from "vitest";
import { performOrderAction } from "@/server/services/orders";
import { asUser, freshDemoOrder, memberOf, rawAs, system } from "../support/helpers";
import { ORG_A, ORG_B } from "../support/fixtures";

async function attempt<T>(fn: () => Promise<T>) {
  try {
    return { ok: true as const, value: await fn() };
  } catch (error) {
    return { ok: false as const, error };
  }
}

const B_MARINA = "cnh_loc_marina";
const B_JVC = "cnh_loc_jvc";

async function membershipOf(userId: string, org: string) {
  const [m] = await system((db) => db`select id from organization_memberships where organization_id = ${org} and user_id = ${userId}`);
  return String(m.id);
}

describe("domain events cannot be fabricated", () => {
  it("no member — not even an owner — can insert an event, for any organization", async () => {
    const owner = await memberOf(ORG_B, "evt-owner-b", "OWNER");
    for (const org of [ORG_B, ORG_A]) {
      const res = await attempt(() =>
        rawAs(owner, (db) => db`
          insert into domain_events (organization_id, type, aggregate_type, aggregate_id, payload, actor_user_id, actor_label)
          values (${org}, 'order.completed', 'order', 'ord_fake', '{}'::jsonb, ${owner.id}, 'user')`),
      );
      expect(res.ok).toBe(false);
    }
    const [n] = await system((db) => db`select count(*)::int n from domain_events where aggregate_id = 'ord_fake'`);
    expect(n.n).toBe(0);
  });

  it("members cannot mark events processed or change retry metadata", async () => {
    const owner = await memberOf(ORG_A, "evt-owner-a", "OWNER");
    const [ev] = await system((db) => db`select id, processed_at, attempts from domain_events where organization_id = ${ORG_A} and processed_at is null limit 1`);
    await attempt(() => rawAs(owner, (db) => db`update domain_events set processed_at = now(), attempts = 99, last_error = 'x' where id = ${ev.id}`));
    const [after] = await system((db) => db`select processed_at, attempts, last_error from domain_events where id = ${ev.id}`);
    expect(after).toMatchObject({ processed_at: null, attempts: ev.attempts, last_error: null });
  });

  it("processing state and timestamps are reset on every insert, even from trusted code", async () => {
    const [ins] = await system((db) => db`
      insert into domain_events (organization_id, type, aggregate_type, aggregate_id, payload, actor_label, processed_at, attempts, last_error, created_at)
      values (${ORG_A}, 'demo.reset', 'organization', ${ORG_A}, '{}'::jsonb, 'test', now(), 7, 'hidden', '2001-01-01')
      returning id`);
    const [ev] = await system((db) => db`select processed_at, attempts, last_error, created_at from domain_events where id = ${ins.id}`);
    expect(ev.processed_at).toBeNull();
    expect(ev.attempts).toBe(0);
    expect(ev.last_error).toBeNull();
    expect(Date.parse(ev.created_at)).toBeGreaterThan(Date.now() - 60_000);
  });

  it("events from operations carry the real acting user; a definer operation cannot be told to blame someone else", async () => {
    const cook = await memberOf(ORG_A, "evt-cook", "KITCHEN_STAFF", ["loc_marina"]);
    const order = await freshDemoOrder("loc_marina");
    await asUser(cook, (ctx) => performOrderAction(ctx, order.id, { action: "accept" }));
    const [ev] = await system((db) => db`select actor_user_id, actor_label from domain_events where aggregate_id = ${order.id} and type = 'order.accepted'`);
    expect(ev).toMatchObject({ actor_user_id: cook.id, actor_label: "user" });
    // The actor-label argument is ignored for signed-in users.
    const order2 = await freshDemoOrder("loc_marina");
    await rawAs(cook, (db) => db`select public.apply_order_transition(${order2.id}, 'accept', null, null, null, 'simulator')`);
    const [ev2] = await system((db) => db`select actor_user_id, actor_label from domain_events where aggregate_id = ${order2.id} and type = 'order.accepted'`);
    expect(ev2).toMatchObject({ actor_user_id: cook.id, actor_label: "user" });
  });

  it("configuration events are derived from the actual change (no change, no event)", async () => {
    const ops = await memberOf(ORG_A, "evt-ops-noop", "OPERATIONS_MANAGER");
    const count = async () => (await system((db) => db`select count(*)::int n from domain_events where aggregate_id = 'itm_cn_drk_001'`))[0].n as number;
    const before = await count();
    await rawAs(ops, (db) => db`update menu_items set is_available = is_available where id = 'itm_cn_drk_001'`);
    expect(await count()).toBe(before);
    await rawAs(ops, (db) => db`update menu_items set prep_time_minutes = prep_time_minutes + 1 where id = 'itm_cn_drk_001'`);
    expect(await count()).toBe(before + 1);
    const [ev] = await system((db) => db`select type, actor_user_id, payload from domain_events where aggregate_id = 'itm_cn_drk_001' order by created_at desc limit 1`);
    expect(ev).toMatchObject({ type: "menu.item_updated", actor_user_id: ops.id });
    expect(ev.payload.changes).toHaveProperty("prepTimeMinutes");
    expect(ev.payload.changes).not.toHaveProperty("foodCost");
  });
});

describe("location-grant changes are always audited", () => {
  it("grant and revoke by an owner record actor, membership and full before/after state", async () => {
    const owner = await memberOf(ORG_B, "grant-owner", "OWNER");
    const bm = await memberOf(ORG_B, "grant-bm", "BRANCH_MANAGER", [B_MARINA]);
    const mid = await membershipOf(bm.id, ORG_B);

    await rawAs(owner, (db) => db`insert into membership_locations (membership_id, location_id, organization_id) values (${mid}, ${B_JVC}, ${ORG_B})`);
    await rawAs(owner, (db) => db`delete from membership_locations where membership_id = ${mid} and location_id = ${B_MARINA}`);

    const logs = await system((db) => db`
      select action, actor_user_id, entity_id, location_id, before_data, after_data, metadata from audit_logs
      where entity_id = ${mid} and action like 'membership.location_%' order by created_at`);
    const granted = logs.find((l) => l.action === "membership.location_granted" && l.location_id === B_JVC)!;
    expect(granted).toMatchObject({ actor_user_id: owner.id, before_data: null, after_data: { membershipId: mid, locationId: B_JVC, organizationId: ORG_B } });
    expect(granted.metadata).toMatchObject({ membershipId: mid, userId: bm.id, role: "BRANCH_MANAGER" });
    const revoked = logs.find((l) => l.action === "membership.location_revoked")!;
    expect(revoked).toMatchObject({ actor_user_id: owner.id, after_data: null, before_data: { membershipId: mid, locationId: B_MARINA, organizationId: ORG_B } });
  });

  it("grants cannot be edited in place by clients", async () => {
    const owner = await memberOf(ORG_B, "grant-owner-upd", "OWNER");
    const bm = await memberOf(ORG_B, "grant-bm-upd", "BRANCH_MANAGER", [B_MARINA]);
    const mid = await membershipOf(bm.id, ORG_B);
    const res = await attempt(() => rawAs(owner, (db) => db`update membership_locations set location_id = ${B_JVC} where membership_id = ${mid}`));
    expect(res.ok).toBe(false);
    const rows = await system((db) => db`select location_id from membership_locations where membership_id = ${mid}`);
    expect(rows.map((r) => r.location_id)).toEqual([B_MARINA]);
  });

  it("an in-place change by a trusted connection is audited with previous and new state", async () => {
    const bm = await memberOf(ORG_B, "grant-bm-sys", "BRANCH_MANAGER", [B_MARINA]);
    const mid = await membershipOf(bm.id, ORG_B);
    await system((db) => db`update membership_locations set location_id = ${B_JVC} where membership_id = ${mid}`);
    const [log] = await system((db) => db`select before_data, after_data, actor_label, metadata from audit_logs where entity_id = ${mid} and action = 'membership.location_changed'`);
    expect(log).toMatchObject({ actor_label: "system", before_data: { locationId: B_MARINA }, after_data: { locationId: B_JVC } });
    expect(log.metadata.userId).toBe(bm.id);
  });

  it("non-admins cannot grant themselves locations", async () => {
    const bm = await memberOf(ORG_B, "grant-bm-self", "BRANCH_MANAGER", [B_MARINA]);
    const mid = await membershipOf(bm.id, ORG_B);
    const res = await attempt(() => rawAs(bm, (db) => db`insert into membership_locations (membership_id, location_id, organization_id) values (${mid}, ${B_JVC}, ${ORG_B})`));
    expect(res.ok).toBe(false);
    const rows = await system((db) => db`select location_id from membership_locations where membership_id = ${mid}`);
    expect(rows.map((r) => r.location_id)).toEqual([B_MARINA]);
  });
});

describe("channel telemetry requires a verified identity", () => {
  it("a client session without an identity is refused; a member of another location is refused", async () => {
    const [conn] = await system((db) => db`select id, error_count from channel_connections where organization_id = ${ORG_A} and location_id = 'loc_marina' and status <> 'disconnected' limit 1`);
    const anonymousClient = await attempt(() =>
      system(async (db) => {
        await db`set local role authenticated`;
        return db`select public.record_channel_activity(${conn.id}, false)`;
      }),
    );
    expect(anonymousClient.ok).toBe(false);

    const jvcCook = await memberOf(ORG_A, "telemetry-cook-jvc", "KITCHEN_STAFF", ["loc_jvc"]);
    const otherLocation = await attempt(() => rawAs(jvcCook, (db) => db`select public.record_channel_activity(${conn.id}, false)`));
    expect(otherLocation.ok).toBe(false);

    const [after] = await system((db) => db`select error_count from channel_connections where id = ${conn.id}`);
    expect(after.error_count).toBe(conn.error_count);
  });
});
