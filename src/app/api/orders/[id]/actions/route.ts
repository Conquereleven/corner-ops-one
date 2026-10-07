import { handle, parseBody } from "@/server/http";
import { orderActionInputSchema, performOrderAction } from "@/server/services/orders";

export const POST = handle(async (req: Request, ctx: RouteContext<"/api/orders/[id]/actions">) => {
  const input = await parseBody(req, orderActionInputSchema);
  return performOrderAction((await ctx.params).id, input);
});
