import { orderFiltersSchema } from "@/domain/orders/types";
import { listOrders } from "@/server/services/orders";
import { withAppContext } from "@/server/context/request";
import { handle, searchParams } from "@/server/http";

const loc = (req: Request) => searchParams(req).get("location");

export const GET = handle(async (req: Request) => {
  const p = searchParams(req);
  const filters = orderFiltersSchema.parse({
    location: p.get("filterLocation") ?? undefined,
    channel: p.get("channel") ?? undefined,
    status: p.get("status") ?? undefined,
    range: p.get("range") ?? undefined,
    delayed: p.get("delayed") === "1" ? true : undefined,
    q: p.get("q") ?? undefined,
    limit: p.get("limit") ?? undefined,
  });
  return withAppContext({ location: loc(req), strictLocation: true, permission: "orders.view" }, (ctx) => listOrders(ctx, filters));
});
