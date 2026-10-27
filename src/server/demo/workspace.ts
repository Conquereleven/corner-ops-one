
import { iso, startOfDubaiDay } from "@/lib/time";
import { appMode, authProviderName, demoConfig } from "../config";
import type { Db } from "../db/client";
import { withSystemTransaction, type Actor } from "../db/transaction";
import { ConfigurationError, ForbiddenError } from "../errors";
import { createRepositories } from "../repositories";
import { ORG_ID } from "../seed/catalog";
import { generateDemoDatabase } from "../seed/generate";
import { registerDemoIdentity } from "./identity";
import { persistWorkspace } from "./persist";

export const DEMO_ORGANIZATION_ID = ORG_ID;
export const DEMO_SEED_VERSION = "casa-norte-v2";

async function seedDemo(db: Db, now: number) {
  const w = generateDemoDatabase(now);
  await persistWorkspace(db, w);
  await db`
    insert into public.demo_workspace_state (organization_id, seed_version, seeded_at, last_tick_at, next_order_at, next_incident_at, external_sequence)
    values (${DEMO_ORGANIZATION_ID}, ${DEMO_SEED_VERSION}, ${iso(now)}, ${iso(now)}, ${iso(w.simulation.nextOrderAt)}, ${iso(w.simulation.nextIncidentAt)}, ${w.counters.externalSequence + 1000})`;
}

/**
 * Find (or, with the local provider, create) the shared demo auth user and
 * register it as a demo identity: the database then refuses any membership,
 * invitation or organization for it outside the Demo Workspace.
 */
async function ensureDemoUser(db: Db): Promise<string> {
  const id = await findOrCreateDemoUser(db);
  await registerDemoIdentity(db, id);
  return id;
}

async function findOrCreateDemoUser(db: Db): Promise<string> {
  const { email, password } = demoConfig();
  const existing = await db`select id from auth.users where lower(email) = ${email}`;
  if (existing.length) return String(existing[0].id);
  if (authProviderName() !== "local") {
    throw new ConfigurationError(`Demo user ${email} does not exist. Provision it in Supabase Auth (see docs/supabase.md).`);
  }
  // Local development: the demo user has no usable password unless DEMO_USER_PASSWORD is set.
  const secret = password || crypto.randomUUID();
  const [row] = await db`
    insert into auth.users (email, encrypted_password, email_confirmed_at, raw_user_meta_data)
    values (${email}, extensions.crypt(${secret}, extensions.gen_salt('bf', 10)), now(), ${db.json({ full_name: "Demo Operator" })})
    returning id`;
  return String(row.id);
}

async function ensureDemoMembership(db: Db, userId: string) {
  await db`
    insert into public.organization_memberships (organization_id, user_id, role, status)
    values (${DEMO_ORGANIZATION_ID}, ${userId}, 'ADMIN', 'active')
    on conflict (organization_id, user_id) do update set status = 'active', role = 'ADMIN'`;
}

interface PriorMember {
  userId: string;
  role: string;
  status: string;
  locationIds: string[];
}

/** Restore members other than the shared demo user exactly as they were (role, status, location grants). */
async function restoreMembers(db: Db, members: PriorMember[]) {
  const locations = new Set((await db`select id from public.locations where organization_id = ${DEMO_ORGANIZATION_ID}`).map((r) => String(r.id)));
  for (const m of members) {
    const [row] = await db`
      insert into public.organization_memberships (organization_id, user_id, role, status)
      values (${DEMO_ORGANIZATION_ID}, ${m.userId}, ${m.role}, ${m.status})
      on conflict (organization_id, user_id) do nothing
      returning id`;
    const grants = m.locationIds.filter((l) => locations.has(l));
    if (row && grants.length) {
      await db`insert into public.membership_locations ${db(grants.map((l) => ({ membership_id: row.id, location_id: l, organization_id: DEMO_ORGANIZATION_ID })))}`;
    }
  }
}

function isStale(seededAtIso: string, now: number) {
  return demoConfig().autoRefresh === "daily" && startOfDubaiDay(Date.parse(seededAtIso)) < startOfDubaiDay(now);
}

async function wipeDemo(db: Db) {
  const [org] = await db`select is_demo from public.organizations where id = ${DEMO_ORGANIZATION_ID}`;
  if (org && !org.is_demo) throw new ForbiddenError("Refusing to reset a non-demo organization.");
  await db`select set_config('cornerops.allow_audit_purge', 'on', true)`;
  await db`delete from public.organizations where id = ${DEMO_ORGANIZATION_ID} and is_demo`;
  await db`select set_config('cornerops.allow_audit_purge', 'off', true)`;
}

/**
 * Make sure the Demo Workspace exists, is seeded and (by default) refreshed
 * once per day, and that the shared demo user is a member. Returns the demo
 * user id. Only allowed when APP_MODE=demo.
 */
export async function ensureDemoWorkspace(now = Date.now()): Promise<{ userId: string; seeded: boolean }> {
  if (appMode() !== "demo") throw new ForbiddenError("The Demo Workspace is disabled in production mode.");
  return withSystemTransaction(async (db) => {
    await db`select pg_advisory_xact_lock(hashtext('cornerops:demo-workspace'))`;
    const userId = await ensureDemoUser(db);
    const [state] = await db`select seeded_at, seed_version from public.demo_workspace_state where organization_id = ${DEMO_ORGANIZATION_ID}`;
    let seeded = false;
    if (!state || state.seed_version !== DEMO_SEED_VERSION || isStale(String(state.seeded_at), now)) {
      await wipeDemo(db);
      await seedDemo(db, now);
      seeded = true;
    }
    await ensureDemoMembership(db, userId);
    return { userId, seeded };
  });
}

/** Restore the Demo Workspace to its initial state (explicit, confirmed action). */
export async function resetDemoWorkspace(actor: Actor, now = Date.now()) {
  if (appMode() !== "demo") throw new ForbiddenError("The Demo Workspace is disabled in production mode.");
  await withSystemTransaction(async (db) => {
    await db`select pg_advisory_xact_lock(hashtext('cornerops:demo-workspace'))`;
    const userId = await ensureDemoUser(db);
    const members: PriorMember[] = (
      await db`
        select m.user_id, m.role, m.status,
          coalesce((select array_agg(ml.location_id) from public.membership_locations ml where ml.membership_id = m.id), '{}') as location_ids
        from public.organization_memberships m
        where m.organization_id = ${DEMO_ORGANIZATION_ID} and m.user_id is not null and m.user_id <> ${userId}`
    ).map((r) => ({ userId: String(r.user_id), role: String(r.role), status: String(r.status), locationIds: (r.location_ids as string[]) ?? [] }));
    await wipeDemo(db);
    await seedDemo(db, now);
    await ensureDemoMembership(db, userId);
    await restoreMembers(db, members);
    const repos = createRepositories(db, DEMO_ORGANIZATION_ID, { financials: true });
    const recorded = actor.kind === "user" && (actor.userId === userId || members.some((m) => m.userId === actor.userId)) ? actor : ({ kind: "system", label: "demo-reset" } as Actor);
    await repos.events.append({ type: "demo.reset", aggregateType: "organization", aggregateId: DEMO_ORGANIZATION_ID, payload: { seedVersion: DEMO_SEED_VERSION } }, recorded);
    await repos.audit.record({ action: "demo.reset", entityType: "organization", entityId: DEMO_ORGANIZATION_ID, metadata: { seedVersion: DEMO_SEED_VERSION } }, recorded);
  });
}

