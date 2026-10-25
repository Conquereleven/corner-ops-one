import { orderChannelSchema } from "@/domain/channels/types";
import { connectionActionSchema, runConnectionAction } from "@/server/services/channels";
import { withAppContext } from "@/server/context/request";
import { handle, parseBody } from "@/server/http";

export const POST = handle(async (req: Request, ctx: RouteContext<"/api/channels/[channel]/connection">) => {
  const channel = orderChannelSchema.parse((await ctx.params).channel);
  const input = await parseBody(req, connectionActionSchema);
  return withAppContext({}, (c) => runConnectionAction(c, channel, input));
});
