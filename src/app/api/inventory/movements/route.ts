import { movementInputSchema, recordMovement } from "@/server/services/inventory";
import { withAppContext } from "@/server/context/request";
import { handle, parseBody } from "@/server/http";

export const POST = handle(async (req: Request) => {
  const input = await parseBody(req, movementInputSchema);
  return withAppContext({}, (c) => recordMovement(c, input));
});
