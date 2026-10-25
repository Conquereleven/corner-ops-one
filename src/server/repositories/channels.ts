import type { ChannelConnection, ChannelLogEntry, ChannelLogLevel, ConnectionStatus, IntegrationMode, OrderChannel } from "@/domain/channels/types";
import type { Db } from "../db/client";
import { chunk, newId, num, optStr, str } from "./mappers";

export interface ChannelRepository {
  connections(locationIds?: string[]): Promise<ChannelConnection[]>;
  updateConnection(c: ChannelConnection): Promise<void>;
  recordActivity(connectionId: string, success: boolean): Promise<void>;
  insertLogs(entries: Omit<ChannelLogEntry, "id">[]): Promise<void>;
  logs(opts: { channel?: OrderChannel; locationIds: string[]; limit: number; matching?: string }): Promise<ChannelLogEntry[]>;
  errorCountSince(sinceIso: string, locationIds: string[]): Promise<Record<string, number>>;
}

const mapConnection = (r: Record<string, unknown>): ChannelConnection => ({
  id: str(r.id),
  organizationId: str(r.organization_id),
  locationId: str(r.location_id),
  channel: str(r.channel_id) as OrderChannel,
  externalStoreId: str(r.external_store_id),
  status: str(r.status) as ConnectionStatus,
  mode: str(r.mode) as IntegrationMode,
  latencyMs: num(r.latency_ms),
  lastSyncAt: optStr(r.last_sync_at) ?? null,
  errorCount: num(r.error_count),
  message: optStr(r.message),
  createdAt: str(r.created_at),
  updatedAt: str(r.updated_at),
});

export function createChannelRepository(db: Db, organizationId: string): ChannelRepository {
  return {
    async connections(locationIds) {
      const rows = locationIds
        ? await db`select * from public.channel_connections where organization_id = ${organizationId} and location_id = any(${locationIds}) order by channel_id, location_id`
        : await db`select * from public.channel_connections where organization_id = ${organizationId} order by channel_id, location_id`;
      return rows.map(mapConnection);
    },
    async updateConnection(c) {
      const rows = await db`
        update public.channel_connections set status = ${c.status}, latency_ms = ${c.latencyMs}, message = ${c.message ?? null},
          last_sync_at = ${c.lastSyncAt}, error_count = ${c.errorCount}
        where id = ${c.id} and organization_id = ${organizationId} returning id`;
      if (!rows.length) throw Object.assign(new Error("connection not updated"), { code: "42501" });
    },
    async recordActivity(connectionId, success) {
      await db`select public.record_channel_activity(${connectionId}, ${success})`;
    },
    async insertLogs(entries) {
      for (const batch of chunk(entries, 500)) {
        await db`insert into public.channel_logs ${db(
          batch.map((e) => ({
            id: newId("log"),
            organization_id: organizationId,
            location_id: e.locationId ?? null,
            channel_id: e.channel,
            level: e.level,
            message: e.message,
            created_at: e.at,
          })),
        )}`;
      }
    },
    async logs({ channel, locationIds, limit, matching }) {
      const rows = await db`
        select * from public.channel_logs
        where organization_id = ${organizationId}
          and (location_id is null or location_id = any(${locationIds}))
          ${channel ? db`and channel_id = ${channel}` : db``}
          ${matching ? db`and position(${matching} in message) > 0` : db``}
        order by created_at desc limit ${limit}`;
      return rows.map((r) => ({
        id: str(r.id),
        channel: str(r.channel_id) as OrderChannel,
        locationId: optStr(r.location_id),
        level: str(r.level) as ChannelLogLevel,
        message: str(r.message),
        at: str(r.created_at),
      }));
    },
    async errorCountSince(sinceIso, locationIds) {
      const rows = await db`
        select channel_id, count(*)::int as n from public.channel_logs
        where organization_id = ${organizationId} and level = 'error' and created_at > ${sinceIso}
          and (location_id is null or location_id = any(${locationIds}))
        group by channel_id`;
      return Object.fromEntries(rows.map((r) => [str(r.channel_id), num(r.n)]));
    },
  };
}
