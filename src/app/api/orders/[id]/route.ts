import { getOrder } from "@/server/services/orders";
import { withAppContext } from "@/server/context/request";
import { handle } from "@/server/http";

export const GET = handle(async (_req: Request, ctx: RouteContext<"/api/orders/[id]">) => {
  const { id } = await ctx.params;
  return withAppContext({ permission: "orders.view" }, (c) => getOrder(c, id));
});
