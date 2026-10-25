import { readinessResponse } from "@/server/health";

export const dynamic = "force-dynamic";

/** Readiness: 200 only when configuration, database, migrations and schema are all in order. */
export const GET = readinessResponse;
