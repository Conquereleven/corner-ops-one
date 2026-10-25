export const dynamic = "force-dynamic";

/** Liveness: the process is up and serving. Does not touch the database. */
export function GET() {
  return Response.json({ status: "ok", service: "cornerops-one" }, { headers: { "Cache-Control": "no-store" } });
}
