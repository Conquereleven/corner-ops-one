import type { IntegrationMode, OrderChannel } from "@/domain/channels/types";
import { createDeliverooMockAdapter } from "./deliveroo/mock";
import { createDirectMockAdapter } from "./direct/mock";
import { createKeetaMockAdapter } from "./keeta/mock";
import { createNoonMockAdapter } from "./noon/mock";
import type { MockChannelAdapter } from "./shared/mock-adapter";
import { createTalabatMockAdapter } from "./talabat/mock";
import type { ChannelAdapter, MockPlatformBackend } from "./types";
import { IntegrationUnavailableError } from "./types";
import { createWhatsAppMockAdapter } from "./whatsapp/mock";

export type MockAdapterRegistry = Record<OrderChannel, MockChannelAdapter>;

/** MOCK integrations — simulated platforms, no credentials, no network. */
export function createMockAdapters(backend: MockPlatformBackend): MockAdapterRegistry {
  return {
    talabat: createTalabatMockAdapter(backend) as MockChannelAdapter,
    deliveroo: createDeliverooMockAdapter(backend) as MockChannelAdapter,
    noon: createNoonMockAdapter(backend) as MockChannelAdapter,
    keeta: createKeetaMockAdapter(backend) as MockChannelAdapter,
    direct: createDirectMockAdapter(backend) as MockChannelAdapter,
    whatsapp: createWhatsAppMockAdapter(backend) as MockChannelAdapter,
  };
}

/**
 * REAL integrations. None ship in v0.1: each live adapter must implement
 * ChannelAdapter against the platform's partner API (credentials held
 * server-side). Until then, requesting one fails loudly instead of pretending.
 */
export function createLiveAdapter(channel: OrderChannel): ChannelAdapter {
  throw new IntegrationUnavailableError(channel);
}

export function resolveAdapter(
  channel: OrderChannel,
  mode: IntegrationMode,
  mocks: MockAdapterRegistry,
): ChannelAdapter {
  return mode === "live" ? createLiveAdapter(channel) : mocks[channel];
}
