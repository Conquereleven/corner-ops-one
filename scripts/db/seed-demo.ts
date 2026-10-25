/**
 * Seed a database for development.
 *
 *   npm run db:seed:demo                    # Demo Workspace (Casa Norte, simulated)
 *   npm run db:seed:demo -- --fixtures      # + "Casa Norte Hospitality LLC" fixture tenant
 *                                           #   with one local user per role (LOCAL DB ONLY)
 *
 * Fixture users use LOCAL_FIXTURE_PASSWORD from .env.local and are refused on
 * hosted Supabase databases. They exist to exercise roles and RLS locally.
 */
import { closeSql } from "../../src/server/db/client";
import { withSystemTransaction } from "../../src/server/db/transaction";
import { namespaceWorkspace, persistWorkspace } from "../../src/server/demo/persist";
import { ensureDemoWorkspace } from "../../src/server/demo/workspace";
import { generateDemoDatabase } from "../../src/server/seed/generate";

const FIXTURE_ORG = "org_casanorte_hosp";
const FIXTURE_USERS = [
  { email: "owner@casanorte.test", name: "Layla Al Mansouri", role: "OWNER", locations: [] as string[] },
  { email: "admin@casanorte.test", name: "Marco Villanueva", role: "ADMIN", locations: [] },
  { email: "ops@casanorte.test", name: "Sara Haddad", role: "OPERATIONS_MANAGER", locations: [] },
  { email: "branch@casanorte.test", name: "Omar Haddad", role: "BRANCH_MANAGER", locations: ["cnh_loc_marina", "cnh_loc_jvc"] },
  { email: "kitchen@casanorte.test", name: "Alejandro Ruiz", role: "KITCHEN_STAFF", locations: ["cnh_loc_marina"] },
];

async function seedFixtures() {
  const url = process.env.DATABASE_URL ?? "";
  if (/supabase\.(co|com)/.test(url)) throw new Error("Fixture users are for local databases only.");
  const password = process.env.LOCAL_FIXTURE_PASSWORD;
  if (!password || password.length < 10) throw new Error("Set LOCAL_FIXTURE_PASSWORD (10+ chars) in .env.local for fixture users.");
  await withSystemTransaction(async (db) => {
    const [exists] = await db`select 1 from public.organizations where id = ${FIXTURE_ORG}`;
    if (!exists) {
      const w = namespaceWorkspace(generateDemoDatabase(Date.now()), { prefix: "cnh_", organizationId: FIXTURE_ORG, name: "Casa Norte Hospitality LLC", slug: "casa-norte-hospitality", isDemo: false });
      w.settings.demo.enabled = false;
      await persistWorkspace(db, w);
    }
    for (const u of FIXTURE_USERS) {
      const [user] = await db`
        insert into auth.users (email, encrypted_password, email_confirmed_at, raw_user_meta_data)
        values (${u.email}, extensions.crypt(${password}, extensions.gen_salt('bf', 10)), now(), ${db.json({ full_name: u.name })})
        on conflict (email) do update set encrypted_password = excluded.encrypted_password
        returning id`;
      const [m] = await db`
        insert into public.organization_memberships (organization_id, user_id, role, status) values (${FIXTURE_ORG}, ${user.id}, ${u.role}, 'active')
        on conflict (organization_id, user_id) do update set role = excluded.role, status = 'active' returning id`;
      await db`delete from public.membership_locations where membership_id = ${m.id}`;
      for (const loc of u.locations) await db`insert into public.membership_locations (membership_id, location_id, organization_id) values (${m.id}, ${loc}, ${FIXTURE_ORG})`;
    }
  });
  console.log(`Fixture tenant "Casa Norte Hospitality LLC" ready. Users (password = LOCAL_FIXTURE_PASSWORD):`);
  for (const u of FIXTURE_USERS) console.log(`  ${u.role.padEnd(18)} ${u.email}${u.locations.length ? `  (${u.locations.join(", ")})` : ""}`);
}

async function main() {
  const { seeded } = await ensureDemoWorkspace();
  console.log(seeded ? "Demo Workspace seeded." : "Demo Workspace already up to date.");
  if (process.argv.includes("--fixtures")) await seedFixtures();
  await closeSql();
}

main().catch(async (err) => {
  console.error(err.message);
  await closeSql();
  process.exit(1);
});
