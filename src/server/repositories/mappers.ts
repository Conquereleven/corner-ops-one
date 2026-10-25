/** Row ↔ domain mapping helpers shared by repositories. */
type Row = Record<string, unknown>;

export const str = (v: unknown): string => (v === null || v === undefined ? "" : String(v));
export const optStr = (v: unknown): string | undefined => (v === null || v === undefined ? undefined : String(v));
export const num = (v: unknown): number => (v === null || v === undefined ? 0 : Number(v));
export const optNum = (v: unknown): number | undefined => (v === null || v === undefined ? undefined : Number(v));
export const hhmm = (v: unknown): string => str(v).slice(0, 5);

/** Drop undefined values so postgres.js treats them as absent, and convert undefined→null in inserts. */
export function nullify<T extends Row>(row: T): T {
  const out: Row = {};
  for (const [k, v] of Object.entries(row)) out[k] = v === undefined ? null : v;
  return out as T;
}

export function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

export function newId(prefix: string): string {
  return `${prefix}_${crypto.randomUUID().replace(/-/g, "").slice(0, 20)}`;
}
