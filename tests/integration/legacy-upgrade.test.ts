/**
 * Real v0.2.0 → v0.2.1 upgrade (Codex audit 2, CRITICAL "legacy demo access").
 *
 * A separate disposable database is built with the v0.2.0 migrations only,
 * populated through the v0.2.0 code path (the shared demo identity onboarding a
 * production organization as OWNER), then upgraded in two steps:
 *   1. to the audited v0.2.1 commit — the exploit is reproduced there;
 *   2. to this branch — the same access must be gone, the rows quarantined and
 *      unrelated customer memberships untouched.
 */
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { resolveIdentity } from "@/server/context/app-context";
import { registerDemoIdentity } from "@/server/demo/identity";
import { migrate } from "../../scripts/db/migrate";
import { assertDisposableTestDatabase, verifyDisposableServer } from "../support/db-safety";

const V020_HEAD = "20261025100400"; // last migration of v0.2.0 (6e6176f)
const AUDITED_HEAD = "20261026100300"; // last migration at the audited commit 458802a

const base = assertDisposableTestDatabase(process.env.TEST_DATABASE_URL ?? "postgres://postgres@127.0.0.1:54329/cornerops_test");
const scratch = assertDisposableTestDatabase(base.url.replace(/\/cornerops_test(_[a-z0-9]+)?$/, "/cornerops_test_upgrade"));

let admin: postgres.Sql;
let sql: postgres.Sql;

const ids = { demo: "", demo2: "", customer: "" };
let PROD = "";
let PROD2 = "";

/** Raw SQL as an authenticated user on the scratch database (RLS applies). */
function as<T>(userId: string, fn: (tx: postgres.TransactionSql) => Promise<T>): Promise<T> {
  return sql.begin(async (tx) => {
    await tx`select set_config('request.jwt.claims', ${JSON.stringify({ sub: userId, role: "authenticated" })}, true)`;
    await tx`set local role authenticated`;
    return fn(tx);
  }) as Promise<T>;
}

async function attempt<T>(fn: () => Promise<T>) {
  try {
    return { ok: true as const, value: await fn() };
  } catch (error) {
    return { ok: false as const, error };
  }
}

const visibleProdOrgs = (userId: string) =>
  as(userId, async (tx) => (await tx`select id from public.organizations where id in (${PROD}, ${PROD2}) order by id`).map((r) => String(r.id)));

beforeAll(async () => {
  admin = postgres(scratch.adminUrl, { max: 1, onnotice: () => {} });
  await verifyDisposableServer(admin as never);
  await admin.unsafe(`drop database if exists ${scratch.quotedDatabase} with (force)`);
  await admin.unsafe(`create database ${scratch.quotedDatabase}`);
  await migrate(scratch.url, { localEmulation: true, target: V020_HEAD, log: () => {} });
  sql = postgres(scratch.url, { max: 2, onnotice: () => {} });

  // --- v0.2.0 state -------------------------------------------------------------
  const user = async (email: string) =>
    String((await sql`insert into auth.users (email, email_confirmed_at) values (${email}, now()) returning id`)[0].id);
  ids.demo = await user("demo@cornerops.one");
  ids.demo2 = await user("demo-two@cornerops.one");
  ids.customer = await user("ops@customer.test");

  await sql`insert into public.organizations (id, name, slug, is_demo) values ('org_cornerops_demo', 'CornerOps Demo', 'cornerops-demo', true)`;
  await sql`insert into public.organization_memberships (organization_id, user_id, role, status) values ('org_cornerops_demo', ${ids.demo}, 'ADMIN', 'active')`;

  // The v0.2.0 exploit path: the shared demo identity onboards a production organization and becomes its OWNER.
  for (const [uid, slug] of [[ids.demo, "escaped"], [ids.demo2, "escaped-two"]] as const) {
    await as(uid, (tx) => tx`select public.create_organization('Customer Kitchen', ${slug}, 'Asia/Dubai', 'AED', ${tx.json({ sla: {}, economics: {}, demo: { enabled: false } })})`);
  }
  PROD = String((await sql`select id from public.organizations where slug = 'escaped'`)[0].id);
  PROD2 = String((await sql`select id from public.organizations where slug = 'escaped-two'`)[0].id);
  const [rst] = await sql`select id from public.restaurants where organization_id = ${PROD}`;
  await sql`insert into public.locations (id, organization_id, restaurant_id, name, code, open_time, close_time) values ('loc_customer', ${PROD}, ${rst.id}, 'Main', 'MAIN', '10:00', '23:00')`;
  // A real customer is also a member of that organization (must survive untouched).
  await sql`insert into public.organization_memberships (organization_id, user_id, role, status) values (${PROD}, ${ids.customer}, 'ADMIN', 'active')`;
  // A pending invitation to the demo email in a production organization.
  await sql`insert into public.organization_memberships (organization_id, invited_email, role, status) values (${PROD2}, 'demo@cornerops.one', 'ADMIN', 'invited')`;
}, 180_000);

afterAll(async () => {
  await sql?.end();
  await admin?.unsafe(`drop database if exists ${scratch.quotedDatabase} with (force)`);
  await admin?.end();
});

describe("v0.2.0 → v0.2.1 upgrade with a demo identity holding production access", () => {
  it("reproduces the exploit at the audited commit, then the closure migration removes it", async () => {
    // Step 1: upgrade to the audited v0.2.1 commit and register the demo identity (as the app did).
    await migrate(scratch.url, { localEmulation: true, target: AUDITED_HEAD, log: () => {} });
    await sql.begin((tx) => tx`insert into public.demo_identities (user_id) values (${ids.demo}) on conflict do nothing`);
    // Exploit reproduced: the registered demo identity still sees and administers the production organization.
    expect(await visibleProdOrgs(ids.demo)).toEqual([PROD]);
    const renamed = await as(ids.demo, async (tx) => (await tx`update public.organizations set name = 'pwned' where id = ${PROD} returning id`).length);
    expect(renamed).toBe(1);
    await sql`update public.organizations set name = 'Customer Kitchen' where id = ${PROD}`;

    // Step 2: apply this branch's migrations.
    const res = await migrate(scratch.url, { localEmulation: true, log: () => {} });
    expect(res.applied).toBeGreaterThan(0);

    expect(await visibleProdOrgs(ids.demo)).toEqual([]);
    const renameAgain = await attempt(() => as(ids.demo, async (tx) => (await tx`update public.organizations set name = 'pwned' where id = ${PROD} returning id`).length));
    if (renameAgain.ok) expect(renameAgain.value).toBe(0);
    const [org] = await sql`select name from public.organizations where id = ${PROD}`;
    expect(org.name).toBe("Customer Kitchen");

    // Production data and team are unreachable through every path.
    expect(await as(ids.demo, async (tx) => (await tx`select count(*)::int n from public.locations where organization_id = ${PROD}`)[0].n)).toBe(0);
    expect((await attempt(() => as(ids.demo, (tx) => tx`insert into public.organization_memberships (organization_id, invited_email, role, status) values (${PROD}, 'friend@x.test', 'OWNER', 'invited')`))).ok).toBe(false);
    const reactivate = await attempt(() => as(ids.demo, async (tx) => (await tx`update public.organization_memberships set status = 'active' where organization_id = ${PROD} and user_id = ${ids.demo} returning id`).length));
    if (reactivate.ok) expect(reactivate.value).toBe(0); // refused by RLS (no effective OWNER/ADMIN membership) or by the guard
    expect((await attempt(() => as(ids.demo, (tx) => tx`select public.create_organization('Again', 'again', 'Asia/Dubai', 'AED', '{}'::jsonb)`))).ok).toBe(false);
    expect((await attempt(() => as(ids.demo, (tx) => tx`select * from public.financial_menu_costs(${PROD})`))).ok).toBe(false);

    // The application resolves only the demo organization for this identity.
    const identity = await as(ids.demo, (tx) => resolveIdentity(tx, { id: ids.demo, email: "demo@cornerops.one", name: null }, { includeDemo: true }));
    expect(identity.memberships.map((m) => m.organizationId)).toEqual(["org_cornerops_demo"]);

    // Quarantined, not deleted; audited.
    const [m] = await sql`select status from public.organization_memberships where organization_id = ${PROD} and user_id = ${ids.demo}`;
    expect(m.status).toBe("disabled");
    const q = await sql`select organization_id, role, previous_status from public.demo_identity_quarantine where user_id = ${ids.demo} or invited_email = 'demo@cornerops.one' order by organization_id`;
    expect(q.map((r) => [r.organization_id, r.role, r.previous_status]).sort()).toEqual(
      [
        [PROD, "OWNER", "active"],
        [PROD2, "ADMIN", "invited"],
      ].sort(),
    );
    const [audit] = await sql`select actor_label from public.audit_logs where organization_id = ${PROD} and action = 'membership.quarantined'`;
    expect(audit.actor_label).toBe("system");

    // Unrelated customer membership is untouched and still works.
    const [c] = await sql`select role, status from public.organization_memberships where organization_id = ${PROD} and user_id = ${ids.customer}`;
    expect(c).toMatchObject({ role: "ADMIN", status: "active" });
    expect(await visibleProdOrgs(ids.customer)).toEqual([PROD]);
  });

  it("a demo identity registered after the upgrade is quarantined at registration", async () => {
    expect(await visibleProdOrgs(ids.demo2)).toEqual([PROD2]); // not a demo identity yet: legitimate owner
    await sql.begin((tx) => registerDemoIdentity(tx, ids.demo2));
    expect(await visibleProdOrgs(ids.demo2)).toEqual([]);
    const [m] = await sql`select status from public.organization_memberships where organization_id = ${PROD2} and user_id = ${ids.demo2}`;
    expect(m.status).toBe("disabled");
  });

  it("even a trusted connection cannot re-activate a quarantined membership", async () => {
    const res = await attempt(() => sql`update public.organization_memberships set status = 'active' where organization_id = ${PROD} and user_id = ${ids.demo}`);
    expect(res.ok).toBe(false);
  });
});
