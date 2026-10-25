import "server-only";
import { cookies } from "next/headers";
import { withSystemTransaction } from "../db/transaction";
import { ConflictError, UnauthenticatedError } from "../errors";
import { createSessionToken, LOCAL_SESSION_COOKIE, SESSION_TTL_SECONDS, verifySessionToken } from "./session";
import type { AuthProvider, SessionUser } from "./types";

/**
 * DEVELOPMENT-ONLY stand-in for Supabase Auth. Verifies bcrypt hashes in the
 * auth.users table (same column Supabase Auth uses) of the LOCAL database and
 * issues a signed cookie. Refused in staging/production by config.ts.
 */
export async function verifyLocalCredentials(email: string, password: string): Promise<SessionUser | null> {
  return withSystemTransaction(async (tx) => {
    const rows = await tx`
      update auth.users set last_sign_in_at = now()
      where lower(email) = lower(${email}) and encrypted_password is not null
        and encrypted_password = extensions.crypt(${password}, encrypted_password)
      returning id, email, raw_user_meta_data ->> 'full_name' as name`;
    return rows[0] ? { id: String(rows[0].id), email: String(rows[0].email), name: (rows[0].name as string) ?? null } : null;
  });
}

export async function createLocalUser(input: { email: string; password: string; fullName: string }): Promise<SessionUser | null> {
  return withSystemTransaction(async (tx) => {
    const rows = await tx`
      insert into auth.users (email, encrypted_password, email_confirmed_at, raw_user_meta_data)
      values (lower(${input.email}), extensions.crypt(${input.password}, extensions.gen_salt('bf', 10)), now(), ${tx.json({ full_name: input.fullName })})
      on conflict (email) do nothing
      returning id, email`;
    return rows[0] ? { id: String(rows[0].id), email: String(rows[0].email), name: input.fullName } : null;
  });
}

export async function setLocalSessionCookie(user: SessionUser) {
  (await cookies()).set(LOCAL_SESSION_COOKIE, await createSessionToken({ sub: user.id, email: user.email }), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_TTL_SECONDS,
  });
}

export const localAuthProvider: AuthProvider = {
  name: "local",
  async getUser() {
    const session = await verifySessionToken((await cookies()).get(LOCAL_SESSION_COOKIE)?.value);
    return session ? { id: session.sub, email: session.email, name: null } : null;
  },
  async signInWithPassword(email, password) {
    const user = await verifyLocalCredentials(email, password);
    if (!user) throw new UnauthenticatedError("Email or password is incorrect.");
    await setLocalSessionCookie(user);
    return user;
  },
  async signUp(input) {
    const user = await createLocalUser(input);
    if (!user) throw new ConflictError("An account with this email already exists. Sign in instead.");
    await setLocalSessionCookie(user);
    return { user, confirmationRequired: false };
  },
  async signOut() {
    (await cookies()).delete(LOCAL_SESSION_COOKIE);
  },
};
