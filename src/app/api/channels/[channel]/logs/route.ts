import { orderChannelSchema } from "@/domain/channels/types";
import { getChannelLogs } from "@/server/services/channels";
import { withAppContext } from "@/server/context/request";
import { handle } from "@/server/http";

export const GET = handle(async (_req: Request, ctx: RouteContext<"/api/channels/[channel]/logs">) => {
  const channel = orderChannelSchema.parse((await ctx.params).channel);
  return withAppContext({ permission: "channels.view" }, (c) => getChannelLogs(c, channel));
});
