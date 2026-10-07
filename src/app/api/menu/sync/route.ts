import { handle, parseBody } from "@/server/http";
import { menuSyncSchema, syncMenu } from "@/server/services/menu";

export const POST = handle(async (req: Request) => syncMenu(await parseBody(req, menuSyncSchema)));
