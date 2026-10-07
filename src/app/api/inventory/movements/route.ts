import { handle, parseBody } from "@/server/http";
import { movementInputSchema, recordMovement } from "@/server/services/inventory";

export const POST = handle(async (req: Request) => recordMovement(await parseBody(req, movementInputSchema)));
