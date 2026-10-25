# Channel credentials (future live integrations)

No marketplace credentials are used or requested in v0.2. All six channels run through mock
adapters. This note fixes the approach so live integrations can be added safely later, using
official partner access only.

## Rules

1. **Never store a secret in `channel_connections`.** The table holds a
   `credential_reference` — a pointer such as `vault://cornerops/talabat/<store-id>` — validated
   by a check constraint (`vault://`, `secretsmanager://` or `env://` schemes only).
2. Secret values live in a server-side secrets store (e.g. Supabase Vault or the hosting
   platform's secret manager). Only server code resolves a reference, at call time.
3. Secrets never reach the browser, API responses, logs, domain events or audit metadata
   (`redact()` strips credential-like keys from audit metadata).
4. Rotation updates the secret behind the reference; the reference itself does not change.

## Live adapter shape

A live adapter implements the existing `ChannelAdapter` interface (`src/adapters/types.ts`):
normalize the platform payload into `UnifiedOrder`, write status back, report health. Ingestion
goes through `ingestPendingOrders()`, which is idempotent on
`(organization_id, channel_id, external_order_id)` — so webhook retries cannot create duplicates.
Recommended: dispatch status write-backs from the `domain_events` outbox rather than inside the
request transaction once real network calls are involved.
