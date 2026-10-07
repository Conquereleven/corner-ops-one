import { orderChannelSchema } from "@/domain/channels/types";
import { handle } from "@/server/http";
import { getChannelLogs } from "@/server/services/channels";

export const GET = handle(async (_req: Request, ctx: RouteContext<"/api/channels/[channel]/logs">) =>
  getChannelLogs(orderChannelSchema.parse((await ctx.params).channel)),
);
