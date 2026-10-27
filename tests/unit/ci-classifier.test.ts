import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { classifyChanges, classifyFile } from "../../scripts/ci/classify-changes";

const ROOT = resolve(__dirname, "../..");

const SECURITY_RELEVANT = [
  "src/app/api/orders/[id]/actions/route.ts",
  "src/app/api/health/ready/route.ts",
  "src/app/(app)/orders/page.tsx",
  "src/proxy.ts",
  "src/server/auth/local-provider.ts",
  "src/domain/auth/permissions.ts",
  "src/server/context/app-context.ts",
  "src/server/repositories/orders.ts",
  "src/server/services/inventory.ts",
  "src/server/db/transaction.ts",
  "src/lib/time.ts",
  "supabase/migrations/20261027100100_event_authenticity_and_grant_audit.sql",
  "supabase/local/00_supabase_emulation.sql",
  "scripts/db/migrate.ts",
  "scripts/ci/classify-changes.ts",
  "tests/integration/adversarial-sql.test.ts",
  "tests/support/db-safety.ts",
  "package.json",
  "package-lock.json",
  "vitest.config.ts",
  "next.config.ts",
  "railway.json",
  ".github/workflows/ci.yml",
  ".env.example",
];

describe("CI tier classifier", () => {
  it("selects the database tier for every security-relevant area", () => {
    for (const f of SECURITY_RELEVANT) expect(classifyChanges([f]), f).toMatchObject({ database: true });
  });

  it("skips it only for UI/docs-only change sets", () => {
    expect(classifyChanges(["docs/security/rls.md", "README.md", "src/components/orders/order-detail.tsx", "src/hooks/queries.ts"])).toMatchObject({ database: false });
  });

  it("fails closed on empty, blank or malformed input", () => {
    expect(classifyChanges([]).database).toBe(true);
    expect(classifyChanges(["", "   "]).database).toBe(true);
    expect(classifyChanges(["../supabase/migrations/x.sql"]).database).toBe(true);
    expect(classifyChanges(["/etc/passwd"]).database).toBe(true);
    expect(classifyChanges(["src/components/../server/db/client.ts"]).database).toBe(true);
    expect(classifyFile("/nonexistent/changed-files.txt").database).toBe(true);
  });

  it("handles very large change lists, including a single sensitive file at the end", () => {
    const docs = Array.from({ length: 60_000 }, (_, i) => `docs/generated/page-${i}.md`);
    expect(classifyChanges(docs).database).toBe(false);
    expect(classifyChanges([...docs, "supabase/migrations/20990101000000_x.sql"]).database).toBe(true);
    expect(classifyChanges(["src/server/repositories/orders.ts", ...docs]).database).toBe(true);
  });

  it("works through the CLI exactly as CI runs it (no pipes, large list on disk)", () => {
    const dir = mkdtempSync(join(tmpdir(), "classify-"));
    const run = (lines: string[]) => {
      const file = join(dir, "changed.txt");
      writeFileSync(file, lines.join("\n"));
      return execFileSync(process.execPath, ["--no-warnings", "--experimental-strip-types", join(ROOT, "scripts/ci/classify-changes.ts"), file], { encoding: "utf8" }).trim();
    };
    const many = Array.from({ length: 60_000 }, (_, i) => `docs/p-${i}.md`);
    expect(run(many)).toBe("database=false");
    expect(run([...many, "src/proxy.ts"])).toBe("database=true");
  });

  it("the workflow keeps fail-closed wiring and no grep -q pipelines", () => {
    const wf = readFileSync(join(ROOT, ".github/workflows/ci.yml"), "utf8");
    expect(wf).not.toMatch(/grep\s+-q/);
    expect(wf).toContain("scripts/ci/classify-changes.ts");
    expect(wf).toContain("needs.changes.result != 'success' || needs.changes.outputs.database != 'false'");
    expect(wf).toMatch(/permissions:\s*\n\s*contents: read/);
    expect(wf).toContain("cancel-in-progress: true");
    expect(wf).not.toMatch(/secrets\./);
    const code = wf.split("\n").filter((l) => !l.trim().startsWith("#")).join("\n");
    expect(code).not.toMatch(/railway|deploy/i);
  });
});
