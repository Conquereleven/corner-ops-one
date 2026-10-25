import { demoActionSchema, runDemoAction } from "@/server/services/settings";
import { withAppContext } from "@/server/context/request";
import { handle, parseBody } from "@/server/http";

export const POST = handle(async (req: Request) => {
  const input = await parseBody(req, demoActionSchema);
  return withAppContext({}, (c) => runDemoAction(c, input));
});
