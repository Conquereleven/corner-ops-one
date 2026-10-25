import { orderActionInputSchema, performOrderAction } from "@/server/services/orders";
import { withAppContext } from "@/server/context/request";
import { handle, parseBody } from "@/server/http";

export const POST = handle(async (req: Request, ctx: RouteContext<"/api/orders/[id]/actions">) => {
  const { id } = await ctx.params;
  const input = await parseBody(req, orderActionInputSchema);
  return withAppContext({}, (c) => performOrderAction(c, id, input));
});
