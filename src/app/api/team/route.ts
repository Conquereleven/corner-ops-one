import { getTeam, inviteMember, inviteSchema } from "@/server/services/team";
import { withAppContext } from "@/server/context/request";
import { handle, parseBody } from "@/server/http";

export const GET = handle(async () => withAppContext({}, getTeam));
export const POST = handle(async (req: Request) => {
  const input = await parseBody(req, inviteSchema);
  return withAppContext({}, (c) => inviteMember(c, input));
});
