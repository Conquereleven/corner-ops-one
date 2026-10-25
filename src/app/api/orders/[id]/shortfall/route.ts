import { resolveOrderShortfall, shortfallResolutionSchema } from "@/server/services/orders";
import { withAppContext } from "@/server/context/request";
import { handle, parseBody } from "@/server/http";

export const POST = handle(async (req: Request, ctx: RouteContext<"/api/orders/[id]/shortfall">) => {
  const { id } = await ctx.params;
  const input = await parseBody(req, shortfallResolutionSchema);
  return withAppContext({}, (c) => resolveOrderShortfall(c, id, input));
});
