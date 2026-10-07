import { handle, parseBody } from "@/server/http";
import { getSettings, settingsPatchSchema, updateSettings } from "@/server/services/settings";

export const GET = handle(async () => getSettings());
export const PATCH = handle(async (req: Request) => updateSettings(await parseBody(req, settingsPatchSchema)));
