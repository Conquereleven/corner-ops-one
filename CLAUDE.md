@AGENTS.md

# CornerOps Restaurant OS — working notes

- Domain logic lives in `src/domain` (pure). Pages/components must consume `UnifiedOrder`, never channel payloads.
- New channel behaviour goes through `src/adapters/<channel>` (schema → normalize → mock). Live adapters implement `ChannelAdapter`.
- Order status changes go through `server/services/order-transitions.ts#transitionOrder` only.
- Server pages prefetch via `server/prefetch.ts` using keys from `lib/query-keys.ts`; client hooks in `hooks/queries.ts` must use the same keys.
- Time-relative UI must use `useNow()` / `<RelativeTime>` (hydration-safe). Format money/dates with `lib/format.ts` (fixed locale, Asia/Dubai).
- Chart colors: channel palette in `globals.css` (`--ch-*`), validated for CVD; status colors are reserved for state.
- Checks: `npm run typecheck && npm run lint && npm run build`; DB: `npm run db:seed:export && npm run db:verify`.
