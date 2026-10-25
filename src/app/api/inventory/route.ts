import { getInventory } from "@/server/services/inventory";
import { withAppContext } from "@/server/context/request";
import { handle, searchParams } from "@/server/http";

const loc = (req: Request) => searchParams(req).get("location");

export const GET = handle(async (req: Request) => withAppContext({ location: loc(req), strictLocation: true, permission: "inventory.view" }, getInventory));
