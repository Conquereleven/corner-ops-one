import { withSystemTransaction } from "@/server/db/transaction";
import { namespaceWorkspace, persistWorkspace } from "@/server/demo/persist";
import { ensureDemoWorkspace } from "@/server/demo/workspace";
import { generateDemoDatabase } from "@/server/seed/generate";

export const ORG_A = "org_cornerops_demo"; // Demo Workspace
export const ORG_B = "org_casanorte_hosp"; // production-like tenant
export const B_PREFIX = "cnh_";

export async function seedFixtures() {
  await ensureDemoWorkspace();
  const b = namespaceWorkspace(generateDemoDatabase(Date.now()), {
    prefix: B_PREFIX,
    organizationId: ORG_B,
    name: "Casa Norte Hospitality LLC",
    slug: "casa-norte-hospitality",
    isDemo: false,
  });
  b.settings.demo.enabled = false;
  await withSystemTransaction((db) => persistWorkspace(db, b));
}
