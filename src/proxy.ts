import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { LOCAL_SESSION_COOKIE, verifySessionToken } from "@/server/auth/session";

/** Exact paths, or prefixes ending in "/" (so "/api/healthz" is not public). */
const PUBLIC_PATHS = ["/login", "/signup", "/api/auth/"];
const isPublicPath = (pathname: string) => PUBLIC_PATHS.some((p) => (p.endsWith("/") ? pathname.startsWith(p) : pathname === p));

function supabaseAuthEnabled() {
  return (process.env.AUTH_PROVIDER ?? (process.env.NEXT_PUBLIC_SUPABASE_URL ? "supabase" : "local")) === "supabase";
}

/** Refresh the Supabase session cookie (if any) and report whether a user is signed in. */
async function supabaseSession(request: NextRequest): Promise<{ response: NextResponse; signedIn: boolean }> {
  let response = NextResponse.next({ request });
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    (process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY)!,
    {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (list) => {
          list.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          list.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
        },
      },
    },
  );
  const { data } = await supabase.auth.getUser();
  return { response, signedIn: !!data.user };
}

/**
 * Gate the workspace behind a session. This is a convenience redirect only —
 * every API route and page re-validates the session and authorization server-side.
 */
export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  // Health probes never depend on auth configuration (liveness must work even when Supabase settings are incomplete).
  if (pathname === "/api/health" || pathname.startsWith("/api/health/")) return NextResponse.next();
  const isPublic = isPublicPath(pathname);

  let response = NextResponse.next();
  let signedIn = false;
  if (supabaseAuthEnabled()) {
    ({ response, signedIn } = await supabaseSession(request));
  } else {
    signedIn = !!(await verifySessionToken(request.cookies.get(LOCAL_SESSION_COOKIE)?.value));
  }

  if (signedIn) {
    if (pathname === "/login" || pathname === "/signup") return NextResponse.redirect(new URL("/", request.url));
    return response;
  }
  if (isPublic) return response;
  if (pathname.startsWith("/api/")) return NextResponse.json({ error: "Your session has expired. Please sign in again.", code: "unauthenticated" }, { status: 401 });
  const url = new URL("/login", request.url);
  if (pathname !== "/") url.searchParams.set("next", pathname);
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|icon.svg|.*\\.(?:png|jpg|svg|ico|webp)$).*)"],
};
