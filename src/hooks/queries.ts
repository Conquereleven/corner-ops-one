"use client";

import { useMutation, useQuery, useQueryClient, type QueryKey } from "@tanstack/react-query";
import { toast } from "sonner";
import type { BriefingData } from "@/server/services/ai";
import type { AnalyticsData, ProfitabilityData } from "@/server/services/analytics";
import type { ChannelsData } from "@/server/services/channels";
import type { InventoryData } from "@/server/services/inventory";
import type { KitchenData } from "@/server/services/kitchen";
import type { LocationDirectory, LocationsData } from "@/server/services/locations";
import type { MenuData } from "@/server/services/menu";
import type { OrderDetailData, OrdersData } from "@/server/services/orders";
import type { OverviewData } from "@/server/services/overview";
import type { SearchData } from "@/server/services/search";
import type { SettingsData } from "@/server/services/settings";
import type { ActivityData, TeamData } from "@/server/services/team";
import type { Role } from "@/domain/auth/permissions";
import type { SystemStatusData } from "@/server/services/system";
import type { AIAnswer } from "@/domain/ai/types";
import type { AnalyticsRange } from "@/domain/analytics/range";
import type { ChannelLogEntry, OrderChannel } from "@/domain/channels/types";
import type { MovementInput } from "@/domain/inventory/types";
import type { OrderAction } from "@/domain/orders/state-machine";
import type { UnifiedOrder } from "@/domain/orders/types";
import { applyTransition } from "@/domain/orders/state-machine";
import { api, withParams } from "@/lib/api-client";
import { queryKeys, type OrderListParams } from "@/lib/query-keys";
import { useLocationScope } from "./use-location-scope";

export { queryKeys };
export type { OrderListParams };

const LIVE = 4000;

export function useOverview() {
  const { scope } = useLocationScope();
  return useQuery({
    queryKey: queryKeys.overview(scope),
    queryFn: () => api.get<OverviewData>(withParams("/api/overview", { location: scope })),
    refetchInterval: LIVE,
  });
}

export function useOrders(filters: OrderListParams) {
  const { scope } = useLocationScope();
  return useQuery({
    queryKey: queryKeys.orders(scope, filters),
    queryFn: () => api.get<OrdersData>(withParams("/api/orders", { location: scope, ...filters })),
    refetchInterval: LIVE,
    placeholderData: (prev) => prev,
  });
}

export function useOrder(id: string | null) {
  return useQuery({
    queryKey: queryKeys.order(id ?? ""),
    queryFn: () => api.get<OrderDetailData>(`/api/orders/${id}`),
    enabled: !!id,
    refetchInterval: LIVE,
  });
}

export function useKitchen() {
  const { scope } = useLocationScope();
  return useQuery({
    queryKey: queryKeys.kitchen(scope),
    queryFn: () => api.get<KitchenData>(withParams("/api/kitchen", { location: scope })),
    refetchInterval: 3000,
  });
}

export function useMenu() {
  const { scope } = useLocationScope();
  return useQuery({
    queryKey: queryKeys.menu(scope),
    queryFn: () => api.get<MenuData>(withParams("/api/menu", { location: scope })),
    refetchInterval: 8000,
  });
}

export function useInventory() {
  const { scope } = useLocationScope();
  return useQuery({
    queryKey: queryKeys.inventory(scope),
    queryFn: () => api.get<InventoryData>(withParams("/api/inventory", { location: scope })),
    refetchInterval: 8000,
  });
}

export function useChannels() {
  const { scope } = useLocationScope();
  return useQuery({
    queryKey: queryKeys.channels(scope),
    queryFn: () => api.get<ChannelsData>(withParams("/api/channels", { location: scope })),
    refetchInterval: 5000,
  });
}

export function useChannelLogs(channel: OrderChannel | null) {
  return useQuery({
    queryKey: queryKeys.channelLogs(channel ?? ""),
    queryFn: () => api.get<ChannelLogEntry[]>(`/api/channels/${channel}/logs`),
    enabled: !!channel,
    refetchInterval: 5000,
  });
}

export function useAnalytics(range: AnalyticsRange) {
  const { scope } = useLocationScope();
  return useQuery({
    queryKey: queryKeys.analytics(scope, range),
    queryFn: () => api.get<AnalyticsData>(withParams("/api/analytics", { location: scope, range })),
    refetchInterval: 15000,
    placeholderData: (prev) => prev,
  });
}

export function useProfitability(range: AnalyticsRange) {
  const { scope } = useLocationScope();
  return useQuery({
    queryKey: queryKeys.profitability(scope, range),
    queryFn: () => api.get<ProfitabilityData>(withParams("/api/profitability", { location: scope, range })),
    refetchInterval: 15000,
    placeholderData: (prev) => prev,
  });
}

export function useBriefing() {
  const { scope } = useLocationScope();
  return useQuery({
    queryKey: queryKeys.briefing(scope),
    queryFn: () => api.get<BriefingData>(withParams("/api/ai/briefing", { location: scope })),
    refetchInterval: 20000,
  });
}

export function useLocations() {
  return useQuery({
    queryKey: queryKeys.locations(),
    queryFn: () => api.get<LocationsData>("/api/locations"),
    refetchInterval: LIVE,
  });
}

export function useLocationDirectory() {
  return useQuery({
    queryKey: queryKeys.directory(),
    queryFn: () => api.get<LocationDirectory>("/api/locations?view=directory"),
    staleTime: Infinity,
  });
}

/** Resolve a location id to its display name (directory is prefetched in the layout). */
export function useLocationName() {
  const { data } = useLocationDirectory();
  return (id: string) => data?.find((l) => l.id === id)?.name ?? "—";
}

export function useSettings() {
  return useQuery({
    queryKey: queryKeys.settings(),
    queryFn: () => api.get<SettingsData>("/api/settings"),
    refetchInterval: 5000,
  });
}

export function useSystemStatus() {
  const { scope } = useLocationScope();
  return useQuery({
    queryKey: queryKeys.status(scope),
    queryFn: () => api.get<SystemStatusData>(withParams("/api/system/status", { location: scope })),
    refetchInterval: 3000,
  });
}

export function useSearch(q: string) {
  return useQuery({
    queryKey: ["search", q],
    queryFn: () => api.get<SearchData>(withParams("/api/search", { q })),
    enabled: q.trim().length >= 2,
    placeholderData: (prev) => prev,
  });
}

// ---------------------------------------------------------------------------
// Mutations

const OPERATIONAL_KEYS: QueryKey[] = [["orders"], ["order"], ["kitchen"], ["overview"], ["status"], ["inventory"], ["locations"], ["briefing"], ["menu"], ["channels"]];

function useInvalidateOperational() {
  const qc = useQueryClient();
  return () => OPERATIONAL_KEYS.forEach((queryKey) => qc.invalidateQueries({ queryKey }));
}

interface ActionResult {
  order: UnifiedOrder;
  sync: { ok: boolean; externalStatus: string; error?: string };
}

/**
 * Order status actions with an optimistic update: the state machine is pure,
 * so the client applies the same transition immediately and reconciles on
 * the server response.
 */
export function useOrderAction() {
  const qc = useQueryClient();
  const invalidate = useInvalidateOperational();
  return useMutation({
    mutationFn: (vars: { order: UnifiedOrder; action: OrderAction; reason?: string }) =>
      api.post<ActionResult>(`/api/orders/${vars.order.id}/actions`, { action: vars.action, reason: vars.reason }),
    onMutate: async ({ order, action, reason }) => {
      await qc.cancelQueries({ queryKey: ["kitchen"] });
      await qc.cancelQueries({ queryKey: ["orders"] });
      let optimistic: UnifiedOrder;
      try {
        optimistic = applyTransition(order, action, new Date().toISOString(), { reason });
      } catch {
        return;
      }
      const replace = (list: UnifiedOrder[]) => list.map((o) => (o.id === order.id ? optimistic : o));
      qc.setQueriesData<KitchenData>({ queryKey: ["kitchen"] }, (d) => (d ? { ...d, tickets: replace(d.tickets) } : d));
      qc.setQueriesData<OrdersData>({ queryKey: ["orders"] }, (d) => (d ? { ...d, orders: replace(d.orders) } : d));
      qc.setQueriesData<OrderDetailData>({ queryKey: queryKeys.order(order.id) }, (d) => (d ? { ...d, order: optimistic } : d));
    },
    onSuccess: (res) => {
      if (!res.sync.ok) {
        toast.warning(`${res.order.orderNumber} updated in CornerOps`, {
          description: `Channel sync pending: ${res.sync.error ?? "will retry"}`,
        });
      }
    },
    onError: (err: Error) => toast.error("Action failed", { description: err.message }),
    onSettled: invalidate,
  });
}

export function useInjectOrder() {
  const invalidate = useInvalidateOperational();
  return useMutation({
    mutationFn: (vars: { channel?: OrderChannel; locationId?: string }) =>
      api.post<{ order: UnifiedOrder | null; message: string | null }>("/api/demo", { action: "inject", ...vars }),
    onSuccess: (res) => {
      if (!res.order) toast.warning("Order queued on platform", { description: res.message ?? undefined });
    },
    onError: (err: Error) => toast.error("Could not simulate order", { description: err.message }),
    onSettled: invalidate,
  });
}

export function useResetDemo() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.post("/api/demo", { action: "reset", confirm: "RESET" }),
    onSuccess: () => {
      qc.invalidateQueries();
      toast.success("Demo data regenerated");
    },
  });
}

export function useUpdateSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (patch: Record<string, unknown>) => api.patch("/api/settings", patch),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["settings"] });
      qc.invalidateQueries({ queryKey: ["status"] });
      qc.invalidateQueries({ queryKey: ["profitability"] });
      qc.invalidateQueries({ queryKey: ["analytics"] });
    },
    onError: (err: Error) => toast.error("Could not save settings", { description: err.message }),
  });
}

export function useConnectionAction() {
  const invalidate = useInvalidateOperational();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { channel: OrderChannel; action: "connect" | "disconnect" | "reconnect"; locationId?: string }) =>
      api.post(`/api/channels/${vars.channel}/connection`, { action: vars.action, locationId: vars.locationId }),
    onError: (err: Error) => toast.error("Connection action failed", { description: err.message }),
    onSettled: () => {
      invalidate();
      qc.invalidateQueries({ queryKey: ["channel-logs"] });
    },
  });
}

export function useMenuUpdate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { id: string; patch: Record<string, unknown> }) => api.patch(`/api/menu/${vars.id}`, vars.patch),
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ["menu"] });
      qc.invalidateQueries({ queryKey: ["inventory"] });
    },
    onError: (err: Error) => toast.error("Could not update item", { description: err.message }),
  });
}

export function useMenuSync() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { channel: OrderChannel; menuItemId?: string }) => api.post<{ queued: number }>("/api/menu/sync", vars),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ["menu"] });
      if (res.queued === 0) toast.info("Already in sync");
    },
    onError: (err: Error) => toast.error("Sync failed", { description: err.message }),
  });
}

export function useRecordMovement() {
  const invalidate = useInvalidateOperational();
  return useMutation({
    mutationFn: (input: MovementInput) => api.post("/api/inventory/movements", input),
    onSuccess: () => toast.success("Inventory movement recorded"),
    onError: (err: Error) => toast.error("Could not record movement", { description: err.message }),
    onSettled: invalidate,
  });
}

export function useAckAlert() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.post(`/api/alerts/${encodeURIComponent(id)}/ack`),
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ["status"] });
      qc.invalidateQueries({ queryKey: ["overview"] });
      qc.invalidateQueries({ queryKey: ["locations"] });
    },
  });
}

export function useAsk() {
  const { scope } = useLocationScope();
  return useMutation({
    mutationFn: (question: string) => api.post<AIAnswer>(withParams("/api/ai/ask", { location: scope }), { question }),
  });
}

// ---------------------------------------------------------------------------
// Organization, team, locations, activity

export function useTeam(enabled = true) {
  return useQuery({ queryKey: queryKeys.team(), queryFn: () => api.get<TeamData>("/api/team"), enabled });
}

export function useActivity(enabled = true) {
  return useQuery({ queryKey: queryKeys.activity(), queryFn: () => api.get<ActivityData>("/api/activity"), enabled, refetchInterval: 15000 });
}

function useTeamMutation<V>(fn: (v: V) => Promise<unknown>, success?: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: () => {
      if (success) toast.success(success);
      qc.invalidateQueries({ queryKey: queryKeys.team() });
      qc.invalidateQueries({ queryKey: queryKeys.activity() });
    },
    onError: (err: Error) => toast.error("Could not save", { description: err.message }),
  });
}

export function useInviteMember() {
  return useTeamMutation((v: { email: string; role: Role; locationIds: string[] }) => api.post("/api/team", v), "Invitation created");
}

export function useUpdateMember() {
  return useTeamMutation((v: { id: string; patch: { role?: Role; status?: "active" | "disabled"; locationIds?: string[] } }) => api.patch(`/api/team/${v.id}`, v.patch), "Member updated");
}

export function useUpdateOrganization() {
  return useTeamMutation((v: { name: string }) => api.patch("/api/organization", v), "Organization updated");
}

export function useCreateLocation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: Record<string, unknown>) => api.post("/api/locations", v),
    onSuccess: () => {
      toast.success("Location added");
      window.location.reload();
    },
    onError: (err: Error) => toast.error("Could not add location", { description: err.message }),
    onSettled: () => qc.invalidateQueries({ queryKey: queryKeys.activity() }),
  });
}

export function useUpdateLocation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { id: string; patch: Record<string, unknown> }) => api.patch(`/api/locations/${v.id}`, v.patch),
    onSuccess: () => {
      toast.success("Location updated");
      qc.invalidateQueries({ queryKey: queryKeys.locations() });
      qc.invalidateQueries({ queryKey: queryKeys.activity() });
    },
    onError: (err: Error) => toast.error("Could not update location", { description: err.message }),
  });
}
