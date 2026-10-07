import { orderChannelSchema } from "@/domain/channels/types";
import { handle, parseBody } from "@/server/http";
import { connectionActionSchema, runConnectionAction } from "@/server/services/channels";

export const POST = handle(async (req: Request, ctx: RouteContext<"/api/channels/[channel]/connection">) => {
  const channel = orderChannelSchema.parse((await ctx.params).channel);
  return runConnectionAction(channel, await parseBody(req, connectionActionSchema));
});
