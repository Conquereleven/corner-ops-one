import { organizationPatchSchema, updateOrganization } from "@/server/services/team";
import { withAppContext } from "@/server/context/request";
import { handle, parseBody } from "@/server/http";

export const PATCH = handle(async (req: Request) => {
  const patch = await parseBody(req, organizationPatchSchema);
  return withAppContext({}, (c) => updateOrganization(c, patch));
});
