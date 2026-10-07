import "server-only";
import { dehydrate, QueryClient, type QueryKey } from "@tanstack/react-query";
import { cookies } from "next/headers";
import { resolveScope } from "./services/context";
import { getRuntime } from "./store/runtime";

export async function getServerScope(): Promise<string> {
  const value = (await cookies()).get("co_location")?.value;
  return resolveScope(getRuntime(), value ? decodeURIComponent(value) : null);
}

/**
 * Run services on the server and hand the results to TanStack Query on the
 * client, so pages render with data on first paint and then stay live.
 */
export async function prefetch(entries: { queryKey: QueryKey; queryFn: () => Promise<unknown> }[]) {
  const qc = new QueryClient();
  await Promise.all(entries.map((e) => qc.prefetchQuery({ ...e, queryFn: async () => JSON.parse(JSON.stringify(await e.queryFn())) })));
  return dehydrate(qc);
}
