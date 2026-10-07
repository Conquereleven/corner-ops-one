import { handle, searchParams } from "@/server/http";
import { resolveScope } from "@/server/services/context";
import { getMenu } from "@/server/services/menu";
import { getRuntime } from "@/server/store/runtime";

export const GET = handle(async (req: Request) => getMenu(resolveScope(getRuntime(), searchParams(req).get("location"))));
