import { handle } from "@/server/http";
import { getOrder } from "@/server/services/orders";

export const GET = handle(async (_req: Request, ctx: RouteContext<"/api/orders/[id]">) => getOrder((await ctx.params).id));
