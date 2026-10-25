import { analyticsRangeSchema } from "@/domain/analytics/range";
import { getProfitability } from "@/server/services/analytics";
import { withAppContext } from "@/server/context/request";
import { handle, searchParams } from "@/server/http";

const loc = (req: Request) => searchParams(req).get("location");

export const GET = handle(async (req: Request) => {
  const range = analyticsRangeSchema.parse(searchParams(req).get("range") ?? "7d");
  return withAppContext({ location: loc(req), strictLocation: true }, (c) => getProfitability(c, range));
});
