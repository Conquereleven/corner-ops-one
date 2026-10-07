import { handle } from "@/server/http";
import { acknowledgeAlert } from "@/server/services/alerts";
import { live } from "@/server/services/context";

export const POST = handle(async (_req: Request, ctx: RouteContext<"/api/alerts/[id]/ack">) => {
  acknowledgeAlert(await live(), decodeURIComponent((await ctx.params).id));
  return { ok: true };
});
