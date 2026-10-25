import { getSettings, settingsPatchSchema, updateSettings } from "@/server/services/settings";
import { withAppContext } from "@/server/context/request";
import { handle, parseBody } from "@/server/http";

export const GET = handle(async () => withAppContext({}, getSettings));
export const PATCH = handle(async (req: Request) => {
  const patch = await parseBody(req, settingsPatchSchema);
  return withAppContext({}, (c) => updateSettings(c, patch));
});
