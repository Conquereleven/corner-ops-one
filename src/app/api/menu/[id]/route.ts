import { handle, parseBody } from "@/server/http";
import { menuItemPatchSchema, updateMenuItem } from "@/server/services/menu";

export const PATCH = handle(async (req: Request, ctx: RouteContext<"/api/menu/[id]">) =>
  updateMenuItem((await ctx.params).id, await parseBody(req, menuItemPatchSchema)),
);
