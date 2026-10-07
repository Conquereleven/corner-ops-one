import "server-only";
import { ZodError, type ZodType } from "zod";
import { IntegrationUnavailableError } from "@/adapters/types";
import { ConflictError, NotFoundError } from "./services/context";

/** Wrap a route handler with consistent JSON error mapping. */
export function handle<Args extends unknown[]>(fn: (...args: Args) => Promise<unknown>) {
  return async (...args: Args): Promise<Response> => {
    try {
      const data = await fn(...args);
      return Response.json(data, { headers: { "Cache-Control": "no-store" } });
    } catch (err) {
      if (err instanceof ZodError) {
        return Response.json({ error: "Invalid request", issues: err.issues.map((i) => ({ path: i.path.join("."), message: i.message })) }, { status: 400 });
      }
      if (err instanceof NotFoundError) return Response.json({ error: err.message }, { status: 404 });
      if (err instanceof ConflictError) return Response.json({ error: err.message }, { status: 409 });
      if (err instanceof IntegrationUnavailableError) return Response.json({ error: err.message }, { status: 501 });
      console.error("[api]", err);
      return Response.json({ error: "Something went wrong" }, { status: 500 });
    }
  };
}

export async function parseBody<T>(request: Request, schema: ZodType<T>): Promise<T> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    body = undefined;
  }
  return schema.parse(body);
}

export function searchParams(request: Request) {
  return new URL(request.url).searchParams;
}
