import type { Db } from "../db/client";
import { actorColumns, type Actor } from "../db/transaction";
import { optStr, str } from "./mappers";

export interface AuditEntry {
  id: string;
  organizationId: string;
  locationId?: string;
  actorUserId?: string;
  actorLabel?: string;
  actorName?: string;
  action: string;
  entityType: string;
  entityId: string;
  before: unknown;
  after: unknown;
  metadata: Record<string, unknown>;
  createdAt: string;
}

export interface AuditRepository {
  record(entry: { action: string; entityType: string; entityId: string; locationId?: string | null; before?: unknown; after?: unknown; metadata?: Record<string, unknown> }, actor: Actor): Promise<void>;
  list(opts: { limit: number; entityId?: string }): Promise<AuditEntry[]>;
}

const SECRET_KEY = /(secret|token|password|passwd|api[_-]?key|credential|authorization)/i;

/** Audit metadata must never contain secrets. */
export function redact(value: unknown, depth = 0): unknown {
  if (depth > 6 || value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map((v) => redact(v, depth + 1));
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, SECRET_KEY.test(k) ? "[redacted]" : redact(v, depth + 1)]),
  );
}

export function createAuditRepository(db: Db, organizationId: string): AuditRepository {
  return {
    async record(e, actor) {
      const a = actorColumns(actor);
      const json = (v: unknown) => (v === undefined || v === null ? null : db.json(redact(v) as never));
      await db`
        insert into public.audit_logs (organization_id, location_id, actor_user_id, actor_label, action, entity_type, entity_id, before_data, after_data, metadata)
        values (${organizationId}, ${e.locationId ?? null}, ${a.actorUserId}, ${a.actorLabel}, ${e.action}, ${e.entityType}, ${e.entityId},
                ${json(e.before)}, ${json(e.after)}, ${db.json((redact(e.metadata ?? {}) ?? {}) as never)})`;
    },
    async list({ limit, entityId }) {
      const rows = await db`
        select a.*, p.full_name, p.email from public.audit_logs a left join public.profiles p on p.id = a.actor_user_id
        where a.organization_id = ${organizationId} ${entityId ? db`and a.entity_id = ${entityId}` : db``}
        order by a.created_at desc limit ${limit}`;
      return rows.map((r) => ({
        id: str(r.id),
        organizationId: str(r.organization_id),
        locationId: optStr(r.location_id),
        actorUserId: optStr(r.actor_user_id),
        actorLabel: optStr(r.actor_label),
        actorName: optStr(r.full_name) ?? optStr(r.email),
        action: str(r.action),
        entityType: str(r.entity_type),
        entityId: str(r.entity_id),
        before: r.before_data,
        after: r.after_data,
        metadata: (r.metadata as Record<string, unknown>) ?? {},
        createdAt: str(r.created_at),
      }));
    },
  };
}
