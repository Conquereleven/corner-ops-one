import { handle, parseBody } from "@/server/http";
import { demoActionSchema, runDemoAction } from "@/server/services/settings";

export const POST = handle(async (req: Request) => runDemoAction(await parseBody(req, demoActionSchema)));
