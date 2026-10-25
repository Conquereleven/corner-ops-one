import { locationPatchSchema, updateLocation } from "@/server/services/locations";
import { withAppContext } from "@/server/context/request";
import { handle, parseBody } from "@/server/http";

export const PATCH = handle(async (req: Request, ctx: RouteContext<"/api/locations/[id]">) => {
  const { id } = await ctx.params;
  const patch = await parseBody(req, locationPatchSchema);
  return withAppContext({}, (c) => updateLocation(c, id, patch));
});
