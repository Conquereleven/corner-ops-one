import { z } from "zod";
import { search } from "@/server/services/search";
import { withAppContext } from "@/server/context/request";
import { handle, searchParams } from "@/server/http";

export const GET = handle(async (req: Request) => {
  const q = z.string().max(80).parse(searchParams(req).get("q") ?? "");
  return withAppContext({}, (c) => search(c, q));
});
