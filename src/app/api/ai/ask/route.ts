import { handle, parseBody, searchParams } from "@/server/http";
import { askCornerOps, askSchema } from "@/server/services/ai";
import { resolveScope } from "@/server/services/context";
import { getRuntime } from "@/server/store/runtime";

export const POST = handle(async (req: Request) => {
  const { question } = await parseBody(req, askSchema);
  return askCornerOps(resolveScope(getRuntime(), searchParams(req).get("location")), question);
});
