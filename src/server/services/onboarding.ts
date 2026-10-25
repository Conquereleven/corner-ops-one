import "server-only";
import { z } from "zod";
import type { SessionUser } from "../auth/types";
import { withUserTransaction } from "../db/transaction";
import { ConflictError } from "../errors";
import { defaultSettings } from "../seed/generate";

export const createOrganizationSchema = z.object({
  name: z.string().trim().min(2).max(120),
  timezone: z.string().trim().min(3).max(64).default("Asia/Dubai"),
  currency: z.string().trim().length(3).toUpperCase().default("AED"),
});

function slugify(name: string) {
  return (
    name.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "org"
  ) + "-" + crypto.randomUUID().slice(0, 6);
}

/** A signed-in user without a membership creates their organization and becomes its OWNER. */
export async function createOrganization(user: SessionUser, input: z.infer<typeof createOrganizationSchema>) {
  const settings = defaultSettings();
  settings.demo.enabled = false; // production organizations never receive simulated traffic
  return withUserTransaction(user.id, async (db) => {
    const owned = await db`select count(*)::int as n from public.organization_memberships where user_id = ${user.id} and role = 'OWNER' and status = 'active'`;
    if (Number(owned[0].n) >= 5) throw new ConflictError("Organization limit reached for this account.");
    const [r] = await db`select public.create_organization(${input.name}, ${slugify(input.name)}, ${input.timezone}, ${input.currency}, ${db.json(settings as never)}) as id`;
    const id = String(r.id);
    await db`
      insert into public.audit_logs (organization_id, actor_user_id, actor_label, action, entity_type, entity_id, after_data)
      values (${id}, ${user.id}, 'user', 'organization.created', 'organization', ${id}, ${db.json({ name: input.name } as never)})`;
    return { id };
  });
}
