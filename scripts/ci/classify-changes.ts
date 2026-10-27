/**
 * CI tier selection. Decides whether the database/security suite must run.
 *
 * Fail closed: the database tier is skipped ONLY when there is a non-empty,
 * well-formed list of changed files and every one of them is on a short
 * allowlist of files that cannot affect the database, server, API, auth or
 * tests. Anything else — including an unreadable or empty list — selects it.
 *
 *   node --experimental-strip-types scripts/ci/classify-changes.ts <file-with-paths>
 *   prints:  database=true|false   (append to $GITHUB_OUTPUT)
 *
 * Plain TypeScript with erasable syntax only, so CI can run it without npm ci.
 */
import { readFileSync } from "node:fs";

/** Paths that cannot change database, server, API, auth or test behavior. */
const UI_AND_DOCS_ONLY: RegExp[] = [
  /^docs\/[^\0]*$/,
  /^[^/\0]*\.md$/,
  /^[^\0]*\/[^/\0]*\.md$/,
  /^LICENSE$/,
  /^public\/[^\0]*$/,
  /^src\/components\/[^\0]*\.(tsx|css)$/,
  /^src\/hooks\/[^\0]*\.ts$/,
];

const WELL_FORMED = /^(?!\/)(?!.*(^|\/)\.\.(\/|$))[^\0\n\r]+$/;

export interface Classification {
  database: boolean;
  reason: string;
}

export function classifyChanges(paths: readonly string[]): Classification {
  const files = paths.map((p) => p.trim()).filter((p) => p.length > 0);
  if (files.length === 0) return { database: true, reason: "no changed files reported (fail closed)" };
  for (const f of files) {
    if (!WELL_FORMED.test(f)) return { database: true, reason: `unexpected path "${f}" (fail closed)` };
    if (!UI_AND_DOCS_ONLY.some((re) => re.test(f))) return { database: true, reason: `security-relevant change: ${f}` };
  }
  return { database: false, reason: `${files.length} UI/docs-only file(s)` };
}

export function classifyFile(listPath: string): Classification {
  try {
    return classifyChanges(readFileSync(listPath, "utf8").split("\n"));
  } catch {
    return { database: true, reason: "could not read the changed-file list (fail closed)" };
  }
}

const invokedDirectly = typeof process !== "undefined" && process.argv[1] && /classify-changes\.ts$/.test(process.argv[1]);
if (invokedDirectly) {
  const listPath = process.argv[2];
  const result = listPath ? classifyFile(listPath) : { database: true, reason: "no list given (fail closed)" };
  process.stderr.write(`[classify] database=${result.database}: ${result.reason}\n`);
  process.stdout.write(`database=${result.database}\n`);
}
