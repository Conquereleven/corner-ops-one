import "server-only";
import { dehydrate, QueryClient, type DehydratedState, type QueryKey } from "@tanstack/react-query";
import { notFound, redirect } from "next/navigation";
import type { Permission } from "@/domain/auth/permissions";
import type { SessionInfo } from "@/lib/session";
import { appMode } from "./config";
import type { AppContext } from "./context/app-context";
import { withAppContext } from "./context/request";
import { AppError, ForbiddenError, NoOrganizationError, NotFoundError, UnauthenticatedError } from "./errors";

type Entry = { queryKey: QueryKey; queryFn: () => Promise<unknown> };
export type PageData = { state: DehydratedState; ctxScope: string } | { forbidden: string };

const json = <T,>(v: T): T => JSON.parse(JSON.stringify(v));

/**
 * Server-side page loader: resolves the AppContext (auth, organization,
 * permissions, location scope), runs the services and dehydrates their results
 * into TanStack Query. Auth problems become redirects; permission problems a
 * Forbidden screen.
 */
export async function loadPage(opts: { permission?: Permission; location?: string | null }, entries: (ctx: AppContext) => Entry[]): Promise<PageData> {
  let outcome: PageData | "login" | "onboarding" | "notfound";
  try {
    outcome = await withAppContext({ permission: opts.permission, location: opts.location }, async (ctx) => {
      const qc = new QueryClient();
      for (const e of entries(ctx)) await qc.prefetchQuery({ queryKey: e.queryKey, queryFn: async () => json(await e.queryFn()) });
      return { state: dehydrate(qc), ctxScope: ctx.scope.key };
    });
  } catch (err) {
    if (err instanceof UnauthenticatedError) outcome = "login";
    else if (err instanceof NoOrganizationError) outcome = "onboarding";
    else if (err instanceof ForbiddenError) outcome = { forbidden: err.message };
    else if (err instanceof NotFoundError) outcome = "notfound";
    else throw err;
  }
  if (outcome === "login") redirect("/api/auth/expired");
  if (outcome === "onboarding") redirect("/onboarding");
  if (outcome === "notfound") notFound();
  return outcome;
}

export function toSessionInfo(ctx: AppContext): SessionInfo {
  return {
    user: { id: ctx.user.id, name: ctx.user.name, email: ctx.user.email },
    organization: { id: ctx.organization.id, name: ctx.organization.name, isDemo: ctx.organization.isDemo, timezone: ctx.organization.timezone, currency: ctx.organization.currency },
    role: ctx.membership.role,
    permissions: [...ctx.permissions],
    memberships: ctx.memberships.map((m) => ({ organizationId: m.organizationId, organizationName: m.organizationName, isDemo: m.isDemo, role: m.role })),
    locations: ctx.allowedLocations.map((l) => ({ id: l.id, name: l.name, code: l.code })),
    scope: ctx.scope.key,
    appMode: appMode(),
  };
}

export function isAppError(err: unknown): err is AppError {
  return err instanceof AppError;
}

/** Workspace shell: session info + top-bar data, or a redirect to sign-in / onboarding. */
export async function loadShell(entries: (ctx: AppContext) => Entry[]): Promise<{ session: SessionInfo; state: DehydratedState }> {
  let outcome: { session: SessionInfo; state: DehydratedState } | "login" | "onboarding";
  try {
    outcome = await withAppContext({}, async (ctx) => {
      const qc = new QueryClient();
      for (const e of entries(ctx)) await qc.prefetchQuery({ queryKey: e.queryKey, queryFn: async () => json(await e.queryFn()) });
      return { session: toSessionInfo(ctx), state: dehydrate(qc) };
    });
  } catch (err) {
    if (err instanceof UnauthenticatedError) outcome = "login";
    else if (err instanceof NoOrganizationError) outcome = "onboarding";
    else throw err;
  }
  if (outcome === "login") redirect("/api/auth/expired");
  if (outcome === "onboarding") redirect("/onboarding");
  return outcome;
}
