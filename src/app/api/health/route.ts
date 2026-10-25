import { readinessResponse } from "@/server/health";

export const dynamic = "force-dynamic";

/** Backwards-compatible alias of /api/health/ready (liveness is /api/health/live). */
export const GET = readinessResponse;
