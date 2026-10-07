import { handle, searchParams } from "@/server/http";
import { getLocationDirectory, getLocations } from "@/server/services/locations";

export const GET = handle(async (req: Request) =>
  searchParams(req).get("view") === "directory" ? getLocationDirectory() : getLocations(),
);
