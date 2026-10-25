import { createMockAdapters, type MockAdapterRegistry } from "@/adapters/registry";
import type { MockPlatformBackend } from "@/adapters/types";
import type { ChannelConnection, ChannelLogEntry, ChannelLogLevel, ConnectionStatus, OrderChannel } from "@/domain/channels/types";
import { ORDER_CHANNELS } from "@/domain/channels/types";
import { iso } from "@/lib/time";
import type { Repositories } from "../repositories";

/**
 * The simulated platform side of the mock channel adapters, backed by
 * persisted channel connections. Changes are buffered and written with
 * `flush()` inside the caller's transaction.
 *
 *  - "user" mode (staff actions under RLS): telemetry (last sync / errors) goes
 *    through the record_channel_activity() function, so kitchen staff can work
 *    orders without permission to edit connections.
 *  - "system" mode (simulator): connection rows are updated directly.
 */
export class MockBackendSession implements MockPlatformBackend {
  private readonly statusChanged = new Set<string>();
  private readonly activity = new Map<string, boolean>();
  private readonly logs: Omit<ChannelLogEntry, "id">[] = [];

  constructor(
    readonly connections: ChannelConnection[],
    readonly inboxes: Record<string, unknown[]>,
    private readonly rng: () => number,
    private readonly clock: () => number = Date.now,
  ) {
    for (const ch of ORDER_CHANNELS) this.inboxes[ch] ??= [];
  }

  random() {
    return this.rng();
  }
  pushInbox(channel: OrderChannel, payload: unknown) {
    this.inboxes[channel].push(payload);
  }
  drainInbox(channel: OrderChannel) {
    const items = this.inboxes[channel];
    this.inboxes[channel] = [];
    return items;
  }
  getConnections(channel: OrderChannel) {
    return this.connections.filter((c) => c.channel === channel);
  }
  setConnectionStatus(channel: OrderChannel, status: ConnectionStatus, opts: { locationId?: string; message?: string; latencyMs?: number } = {}) {
    const now = iso(this.clock());
    for (const c of this.connections) {
      if (c.channel !== channel || (opts.locationId && c.locationId !== opts.locationId)) continue;
      c.status = status;
      c.message = opts.message;
      if (opts.latencyMs !== undefined) c.latencyMs = opts.latencyMs;
      if (status === "connected") {
        c.errorCount = 0;
        c.lastSyncAt = now;
      }
      this.statusChanged.add(c.id);
    }
  }
  recordSync(channel: OrderChannel, locationId?: string) {
    const now = iso(this.clock());
    for (const c of this.connections) {
      if (c.channel === channel && (!locationId || c.locationId === locationId) && c.status !== "disconnected") {
        c.lastSyncAt = now;
        if (!this.activity.has(c.id)) this.activity.set(c.id, true);
      }
    }
  }
  log(channel: OrderChannel, level: ChannelLogLevel, message: string, locationId?: string) {
    this.logs.push({ channel, level, message, locationId, at: iso(this.clock()) });
    if (level === "error") {
      for (const c of this.connections) {
        if (c.channel === channel && (!locationId || c.locationId === locationId)) {
          c.errorCount += 1;
          this.activity.set(c.id, false);
        }
      }
    }
  }

  /** Changed connections, for event emission by the caller. */
  changedConnections(): ChannelConnection[] {
    return this.connections.filter((c) => this.statusChanged.has(c.id));
  }

  async flush(repos: Repositories, mode: "user" | "system") {
    const touched = mode === "system" ? new Set([...this.statusChanged, ...this.activity.keys()]) : this.statusChanged;
    for (const c of this.connections) if (touched.has(c.id)) await repos.channels.updateConnection(c);
    if (mode === "user") {
      for (const [id, ok] of this.activity) if (!this.statusChanged.has(id)) await repos.channels.recordActivity(id, ok);
    }
    if (this.logs.length) await repos.channels.insertLogs(this.logs);
    this.statusChanged.clear();
    this.activity.clear();
    this.logs.length = 0;
  }
}

export interface ChannelRuntime {
  backend: MockBackendSession;
  adapters: MockAdapterRegistry;
}

/** Load the organization's channel connections and build mock adapters over them. */
export async function loadChannelRuntime(
  repos: Repositories,
  opts: { inboxes?: Record<string, unknown[]>; rng?: () => number; locationIds?: string[] } = {},
): Promise<ChannelRuntime> {
  const connections = await repos.channels.connections(opts.locationIds);
  const backend = new MockBackendSession(connections, opts.inboxes ?? {}, opts.rng ?? Math.random);
  return { backend, adapters: createMockAdapters(backend) };
}
