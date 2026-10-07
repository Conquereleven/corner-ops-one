import type { MockPlatformBackend, NormalizationContext } from "@/adapters/types";
import type { ChannelLogEntry, OrderChannel } from "@/domain/channels/types";
import { iso } from "@/lib/time";
import type { Database } from "./types";

export function newId(db: Database, prefix: string): string {
  db.counters.id += 1;
  return `${prefix}_${db.counters.id.toString(36)}`;
}

const MAX_LOGS = 600;

export function appendChannelLog(db: Database, entry: Omit<ChannelLogEntry, "id">) {
  db.channelLogs.push({ ...entry, id: newId(db, "log") });
  if (db.channelLogs.length > MAX_LOGS) db.channelLogs.splice(0, db.channelLogs.length - MAX_LOGS);
}

/** The simulated platform side for mock adapters, backed by the demo database. */
export function createMockBackend(db: Database, clock: () => number, random: () => number): MockPlatformBackend {
  return {
    random,
    pushInbox(channel, payload) {
      db.inboxes[channel].push(payload);
    },
    drainInbox(channel) {
      const items = db.inboxes[channel];
      db.inboxes[channel] = [];
      return items;
    },
    getConnections(channel) {
      return db.channelConnections.filter((c) => c.channel === channel);
    },
    setConnectionStatus(channel, status, opts = {}) {
      const now = iso(clock());
      for (const c of db.channelConnections) {
        if (c.channel !== channel || (opts.locationId && c.locationId !== opts.locationId)) continue;
        c.status = status;
        c.message = opts.message;
        if (opts.latencyMs !== undefined) c.latencyMs = opts.latencyMs;
        if (status === "connected") {
          c.errorCount = 0;
          c.lastSyncAt = now;
        }
        c.updatedAt = now;
      }
    },
    recordSync(channel, locationId) {
      const now = iso(clock());
      for (const c of db.channelConnections) {
        if (c.channel === channel && (!locationId || c.locationId === locationId) && c.status !== "disconnected") {
          c.lastSyncAt = now;
        }
      }
    },
    log(channel, level, message, locationId) {
      appendChannelLog(db, { channel, level, message, locationId, at: iso(clock()) });
      if (level === "error") {
        for (const c of db.channelConnections) {
          if (c.channel === channel && (!locationId || c.locationId === locationId)) c.errorCount += 1;
        }
      }
    },
  };
}

export function createNormalizationContext(db: Database, now: number): NormalizationContext {
  const menuById = new Map(db.menuItems.map((m) => [m.id, m]));
  return {
    organizationId: db.organization.id,
    restaurantId: db.restaurant.id,
    now,
    resolveLocationId(channel: OrderChannel, externalStoreId: string) {
      return db.channelConnections.find((c) => c.channel === channel && c.externalStoreId === externalStoreId)
        ?.locationId;
    },
    resolveMenuItemId(channel: OrderChannel, externalItemId: string) {
      return db.menuMappings.find((m) => m.channel === channel && m.externalItemId === externalItemId)?.menuItemId;
    },
    estimatePrepMinutes(menuItemIds) {
      const preps = menuItemIds
        .map((id) => (id ? menuById.get(id)?.prepTimeMinutes : undefined))
        .filter((v): v is number => v !== undefined);
      if (!preps.length) return 12;
      const longest = Math.max(...preps);
      return Math.min(25, Math.max(8, Math.round(longest + 1.5 * (preps.length - 1))));
    },
    allocateOrderNumber() {
      db.counters.orderNumber += 1;
      return `CO-${db.counters.orderNumber}`;
    },
    newId(prefix: string) {
      return newId(db, prefix);
    },
  };
}
