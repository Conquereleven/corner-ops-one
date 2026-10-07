import { handle, searchParams } from "@/server/http";
import { getChannels } from "@/server/services/channels";
import { resolveScope } from "@/server/services/context";
import { getRuntime } from "@/server/store/runtime";

export const GET = handle(async (req: Request) => getChannels(resolveScope(getRuntime(), searchParams(req).get("location"))));
