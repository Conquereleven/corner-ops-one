import { z } from "zod";
import { getAuthProvider } from "@/server/auth";
import { handle, parseBody } from "@/server/http";

const schema = z.object({
  fullName: z.string().trim().min(2).max(80),
  email: z.string().trim().toLowerCase().email().max(254),
  password: z.string().min(10, "Use at least 10 characters").max(200),
});

export const POST = handle(async (req: Request) => {
  const input = await parseBody(req, schema);
  const res = await getAuthProvider().signUp(input);
  return { ok: true, confirmationRequired: res.confirmationRequired };
});
