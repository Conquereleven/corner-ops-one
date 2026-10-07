import { orderFiltersSchema } from "@/domain/orders/types";
import { handle, searchParams } from "@/server/http";
import { resolveScope } from "@/server/services/context";
import { listOrders } from "@/server/services/orders";
import { getRuntime } from "@/server/store/runtime";

export const GET = handle(async (req: Request) => {
  const params = searchParams(req);
  const filters = orderFiltersSchema.parse({
    location: params.get("filterLocation") ?? undefined,
    channel: params.get("channel") ?? undefined,
    status: params.get("status") ?? undefined,
    range: params.get("range") ?? undefined,
    delayed: params.get("delayed") === "1" ? true : undefined,
    q: params.get("q") ?? undefined,
    limit: params.get("limit") ?? undefined,
  });
  return listOrders(resolveScope(getRuntime(), params.get("location")), filters);
});
