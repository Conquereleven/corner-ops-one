import { handle, searchParams } from "@/server/http";
import { resolveScope } from "@/server/services/context";
import { getInventory } from "@/server/services/inventory";
import { getRuntime } from "@/server/store/runtime";

export const GET = handle(async (req: Request) => getInventory(resolveScope(getRuntime(), searchParams(req).get("location"))));
