import type { Db } from "../db/client";
import { newId, optStr, str } from "./mappers";

export interface AlertStateRow {
  alertKey: string;
  createdAt: string;
  acknowledgedAt: string | null;
}

export interface AlertRepository {
  states(): Promise<Map<string, AlertStateRow>>;
  /** Record first sighting of derived alerts (no-op for known keys). */
  recordSeen(alerts: { key: string; locationId?: string; channel?: string; severity: string; category: string; title: string; detail: string; href: string }[]): Promise<void>;
  acknowledge(key: string, userId: string | null): Promise<boolean>;
}

export function createAlertRepository(db: Db, organizationId: string): AlertRepository {
  return {
    async states() {
      const rows = await db`select alert_key, created_at, acknowledged_at from public.alerts where organization_id = ${organizationId}`;
      return new Map(rows.map((r) => [str(r.alert_key), { alertKey: str(r.alert_key), createdAt: str(r.created_at), acknowledgedAt: optStr(r.acknowledged_at) ?? null }]));
    },
    async recordSeen(alerts) {
      if (!alerts.length) return;
      await db`
        insert into public.alerts ${db(
          alerts.map((a) => ({
            id: newId("alr"),
            alert_key: a.key,
            organization_id: organizationId,
            location_id: a.locationId ?? null,
            channel_id: a.channel ?? null,
            severity: a.severity,
            category: a.category,
            title: a.title,
            detail: a.detail,
            href: a.href,
          })),
        )}
        on conflict (organization_id, alert_key) do nothing`;
    },
    async acknowledge(key, userId) {
      const rows = await db`
        update public.alerts set acknowledged_at = now(), acknowledged_by = ${userId}
        where organization_id = ${organizationId} and alert_key = ${key} and acknowledged_at is null returning id`;
      return rows.length > 0;
    },
  };
}
