import { membershipPatchSchema, updateMember } from "@/server/services/team";
import { withAppContext } from "@/server/context/request";
import { handle, parseBody } from "@/server/http";

export const PATCH = handle(async (req: Request, ctx: RouteContext<"/api/team/[id]">) => {
  const { id } = await ctx.params;
  const patch = await parseBody(req, membershipPatchSchema);
  return withAppContext({}, (c) => updateMember(c, id, patch));
});
