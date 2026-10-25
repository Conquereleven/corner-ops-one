import { menuItemPatchSchema, updateMenuItem } from "@/server/services/menu";
import { withAppContext } from "@/server/context/request";
import { handle, parseBody } from "@/server/http";

export const PATCH = handle(async (req: Request, ctx: RouteContext<"/api/menu/[id]">) => {
  const { id } = await ctx.params;
  const patch = await parseBody(req, menuItemPatchSchema);
  return withAppContext({}, (c) => updateMenuItem(c, id, patch));
});
