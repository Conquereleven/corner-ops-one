import { handle, searchParams } from "@/server/http";
import { getRuntime } from "@/server/store/runtime";
import { resolveScope } from "@/server/services/context";
import { getOverview } from "@/server/services/overview";

export const GET = handle(async (req: Request) => getOverview(resolveScope(getRuntime(), searchParams(req).get("location"))));
