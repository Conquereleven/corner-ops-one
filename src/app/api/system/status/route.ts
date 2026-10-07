import { handle, searchParams } from "@/server/http";
import { resolveScope } from "@/server/services/context";
import { getSystemStatus } from "@/server/services/system";
import { getRuntime } from "@/server/store/runtime";

export const GET = handle(async (req: Request) => getSystemStatus(resolveScope(getRuntime(), searchParams(req).get("location"))));
