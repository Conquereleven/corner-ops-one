import { handle, searchParams } from "@/server/http";
import { resolveScope } from "@/server/services/context";
import { getKitchenBoard } from "@/server/services/kitchen";
import { getRuntime } from "@/server/store/runtime";

export const GET = handle(async (req: Request) => getKitchenBoard(resolveScope(getRuntime(), searchParams(req).get("location"))));
