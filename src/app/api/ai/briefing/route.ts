import { handle, searchParams } from "@/server/http";
import { getBriefing } from "@/server/services/ai";
import { resolveScope } from "@/server/services/context";
import { getRuntime } from "@/server/store/runtime";

export const GET = handle(async (req: Request) => getBriefing(resolveScope(getRuntime(), searchParams(req).get("location"))));
