import { createLocation, createLocationSchema, getLocationDirectory, getLocations } from "@/server/services/locations";
import { withAppContext } from "@/server/context/request";
import { handle, parseBody, searchParams } from "@/server/http";

const loc = (req: Request) => searchParams(req).get("location");

export const GET = handle(async (req: Request) =>
  searchParams(req).get("view") === "directory"
    ? withAppContext({}, getLocationDirectory)
    : withAppContext({ location: loc(req), strictLocation: true }, getLocations),
);
export const POST = handle(async (req: Request) => {
  const input = await parseBody(req, createLocationSchema);
  return withAppContext({}, (c) => createLocation(c, input));
});
