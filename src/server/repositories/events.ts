import type { DomainEvent, DomainEventType } from "@/domain/events/types";
import type { Db } from "../db/client";
import { actorColumns, type Actor } from "../db/transaction";
import { optStr, str } from "./mappers";

export interface EventRepository {
  append(event: { type: DomainEventType; aggregateType: string; aggregateId: string; locationId?: string | null; payload: unknown }, actor: Actor): Promise<string>;
  list(opts: { limit: number; types?: string[]; aggregateId?: string }): Promise<DomainEvent[]>;
}

export function createEventRepository(db: Db, organizationId: string): EventRepository {
  return {
    async append(e, actor) {
      const a = actorColumns(actor);
      // Id generated here: writers may not have read access to the event log, so no RETURNING.
      const id = crypto.randomUUID();
      await db`
        insert into public.domain_events (id, organization_id, location_id, type, aggregate_type, aggregate_id, payload, actor_user_id, actor_label)
        values (${id}, ${organizationId}, ${e.locationId ?? null}, ${e.type}, ${e.aggregateType}, ${e.aggregateId}, ${db.json((e.payload ?? {}) as never)}, ${a.actorUserId}, ${a.actorLabel})`;
      return id;
    },
    async list({ limit, types, aggregateId }) {
      const rows = await db`
        select * from public.domain_events where organization_id = ${organizationId}
          ${types?.length ? db`and type = any(${types})` : db``}
          ${aggregateId ? db`and aggregate_id = ${aggregateId}` : db``}
        order by created_at desc limit ${limit}`;
      return rows.map((r) => ({
        id: str(r.id),
        organizationId: str(r.organization_id),
        locationId: optStr(r.location_id),
        type: str(r.type) as DomainEventType,
        aggregateType: str(r.aggregate_type),
        aggregateId: str(r.aggregate_id),
        payload: r.payload,
        actorUserId: optStr(r.actor_user_id),
        actorLabel: optStr(r.actor_label),
        createdAt: str(r.created_at),
        processedAt: optStr(r.processed_at),
      }));
    },
  };
}
