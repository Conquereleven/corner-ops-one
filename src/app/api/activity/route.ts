import { getActivity } from "@/server/services/team";
import { withAppContext } from "@/server/context/request";
import { handle } from "@/server/http";

export const GET = handle(async () => withAppContext({}, (c) => getActivity(c)));
