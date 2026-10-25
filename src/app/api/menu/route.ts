import { getMenu } from "@/server/services/menu";
import { withAppContext } from "@/server/context/request";
import { handle, searchParams } from "@/server/http";

const loc = (req: Request) => searchParams(req).get("location");

export const GET = handle(async (req: Request) => withAppContext({ location: loc(req), strictLocation: true, permission: "menu.view" }, getMenu));
