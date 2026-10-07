import { analyticsRangeSchema } from "@/domain/analytics/range";
import { handle, searchParams } from "@/server/http";
import { getProfitability } from "@/server/services/analytics";
import { resolveScope } from "@/server/services/context";
import { getRuntime } from "@/server/store/runtime";

export const GET = handle(async (req: Request) => {
  const p = searchParams(req);
  return getProfitability(resolveScope(getRuntime(), p.get("location")), analyticsRangeSchema.parse(p.get("range") ?? "7d"));
});
