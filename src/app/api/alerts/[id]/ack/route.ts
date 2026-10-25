import { acknowledgeAlert } from "@/server/services/alerts";
import { withAppContext } from "@/server/context/request";
import { handle } from "@/server/http";

export const POST = handle(async (_req: Request, ctx: RouteContext<"/api/alerts/[id]/ack">) => {
  const key = decodeURIComponent((await ctx.params).id);
  return withAppContext({ permission: "alerts.view" }, (c) => acknowledgeAlert(c, key));
});
