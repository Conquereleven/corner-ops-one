import { z } from "zod";
import { getAuthProvider } from "@/server/auth";
import { handle, parseBody } from "@/server/http";

const schema = z.object({ email: z.string().trim().email().max(254), password: z.string().min(1).max(200) });

export const POST = handle(async (req: Request) => {
  const { email, password } = await parseBody(req, schema);
  const user = await getAuthProvider().signInWithPassword(email, password);
  return { ok: true, userId: user.id };
});
