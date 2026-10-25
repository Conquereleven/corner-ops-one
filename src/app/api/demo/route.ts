import { authorizeDemoAction, demoActionSchema, executeDemoAction } from "@/server/services/settings";
import { withAppContext } from "@/server/context/request";
import { handle, parseBody } from "@/server/http";

export const POST = handle(async (req: Request) => {
  const input = await parseBody(req, demoActionSchema);
  // Authorize in the user's transaction, then run the simulator work after it has committed.
  const authorized = await withAppContext({}, async (c) => authorizeDemoAction(c, input));
  return executeDemoAction(authorized);
});
