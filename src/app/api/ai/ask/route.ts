import { askCornerOps, askSchema } from "@/server/services/ai";
import { withAppContext } from "@/server/context/request";
import { handle, parseBody, searchParams } from "@/server/http";

const loc = (req: Request) => searchParams(req).get("location");

export const POST = handle(async (req: Request) => {
  const { question } = await parseBody(req, askSchema);
  return withAppContext({ location: loc(req), strictLocation: true }, (c) => askCornerOps(c, question));
});
