import { z } from "zod";
import { handle, searchParams } from "@/server/http";
import { search } from "@/server/services/search";

export const GET = handle(async (req: Request) => search(z.string().max(80).parse(searchParams(req).get("q") ?? "")));
