<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# CornerOps One · Repository governance (CornerTech AI)

When this adoption PR is approved and merged, read and follow:
- [Execution Standard 1.0](docs/governance/execution-standard.md) for PREPARED → EXECUTED → VERIFIED → CLOSED (and evidenced BLOCKED), one accountable DRI, exact SHAs, real acceptance evidence, and Founder approval gates.
- [CT-WCOS v1.0](docs/governance/world-class-operating-standard.md) for design, engineering, product, AI-native innovation and quality.

**Policy hierarchy:** security, tenant isolation, local restrictions and human approvals still apply; stricter rules win. These files are a prepared proposal until the required independent review and Founder-approved merge, not an unconditional grant of authority.

**Engineering roles:** Claude Code and Codex are peer implementers and independent cross-reviewers. Assign one DRI and a different reviewer on the exact SHA; neither self-approves. Claude Chat is advisory Virtual CTO; ChatGPT coordinates product, acceptance and handoffs. The Founder & CEO owns gated decisions.

**CornerOps One safeguards:** preserve [RLS/authorization](docs/security/rls.md), [Data API boundary](docs/security/data-api.md), [inventory shortage rules](docs/inventory-shortage-policy.md), [migration/restore/hosting gates](docs/deployment/railway.md), and the project-specific rules in [CLAUDE.md](CLAUDE.md). Local PostgreSQL passing tests ≠ hosted Supabase acceptance.

**Temporary Founder exception:** public repository visibility permitted through 2026-10-31; restoration to private planned 2026-11-01. No disclosure of secrets/customer data, merge, deployment, paid resource or production action is authorized by this exception.

Keep task evidence inside the existing issue or PR rather than introducing duplicate bureaucracy. Describe outcome, DRI, scope, environment, positive and negative acceptance criteria, verified SHA, reviewer disposition, residual risks and next owner. A green CI or published PR is not CLOSED by itself.
