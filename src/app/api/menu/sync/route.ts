import { menuSyncSchema, syncMenu } from "@/server/services/menu";
import { withAppContext } from "@/server/context/request";
import { handle, parseBody } from "@/server/http";

export const POST = handle(async (req: Request) => {
  const input = await parseBody(req, menuSyncSchema);
  return withAppContext({}, (c) => syncMenu(c, input));
});
