# TouchGrass — notes for future sessions

Social app for meeting people IRL (Hyderabad launch). Tagline "Log off. Pull up." Full spec is the original build prompt; the feature checklist is `docs/FEATURES.md` (source of truth for progress), architecture is in `docs/ARCHITECTURE.md`, and ambiguity resolutions are in `docs/DECISIONS.md`.

## Commands (run from repo root)

- `pnpm dev`: whole stack locally (docker infra + migrate + seed + api/realtime/worker/web/Expo), fake adapters, no keys
- `pnpm typecheck` · `pnpm lint` · `pnpm format:check`
- `pnpm test`: unit tests (all packages)
- `pnpm test:coverage`: api unit + Testcontainers integration with the ≥85% gate (needs Docker), shared coverage
- `pnpm --filter @touchgrass/api test:integration`: integration suite only
- `pnpm test:e2e:web`: Playwright (builds Next and serves on :3100)
- `pnpm --filter @touchgrass/mobile test`: Jest + RNTL; Maestro flows in `apps/mobile/.maestro` (CI emulator)
- Load test (needs the API running with `TRUST_PROXY_HOPS=1`): `docker run --rm --network host -v "$PWD/infra/k6:/scripts" grafana/k6:1.4.2 run /scripts/rsvp.js` (also `feed.js`, `detail.js`, `chat.js`); see `docs/PERFORMANCE.md` for VU counts and clearing `rl:*` keys
- `pnpm db:migrate` / `pnpm --filter @touchgrass/api db:rollback` / `pnpm db:seed` (after `pnpm build`); production uses `pnpm --filter @touchgrass/api db:bootstrap -- --super-admin <phone>` (reference data only; the dev seed refuses production)
- Infra: `infra/terraform` (README has deploy steps), Dockerfiles in `apps/{api,web}`, EAS profiles in `apps/mobile/eas.json`. What a human must do before launch: `docs/LAUNCH_CHECKLIST.md`
- Docker daemon not running in a fresh sandbox? Start it with `dockerd > /tmp/dockerd.log 2>&1 &`.

## Conventions (enforced by lint/CI)

- TypeScript strict everywhere; `any`, TODO/FIXME/HACK comments, `console`, floating promises are lint errors.
- No placeholders in shipped code. Mock data only in seeds/tests. Never weaken a test to pass; fix the code.
- Shared Zod schemas in `packages/shared` define every request/response; validate with `ZodPipe` in the API and parse responses in clients.
- Errors: throw `AppError(code, message, details)`; codes in `packages/shared/src/errors.ts` are stable.
- Authorisation lives in pure policy functions in the service layer, unit-tested per rule.
- Modules never read another module's tables: call its service or subscribe to its domain events.
- Domain events go through the transactional outbox (`OutboxService.add(tx, …)`), never straight to a queue.
- Retryable writes use `@Idempotent()`; abuse-prone routes use `@RateLimit(...)`.
- Cursor pagination only (`encodeCursor`/`decodeCursor`). Money in paise. Time in UTC, displayed in IST. Phones in E.164.
- Location: `geography(Point,4326)` + GIST; record every new index in ARCHITECTURE.md's index register.
- Migrations: add `apps/api/migrations/NNNN_name/{up,down}.sql`; never edit an applied migration (checksums).
- External services only through `src/adapters` ports, each with a real and a fake implementation, selected by env.
- All UI strings come from `packages/shared/src/i18n/{en,te,hi}.ts` (same keys in all three; the parity test fails otherwise). App vocabulary: Pull up = RSVP, Plot = create plan, Squad = friends, Lore = memories, Crew = recurring group.
- Mobile screens use `components/ui` (Screen/Text/Button/StateViews) and handle loading, empty, error and offline. Touch targets ≥44 pt, labels/roles/hints on interactive elements, `maxFontSizeMultiplier` 2.
- Auth: routes need a session unless `@Public()`; users still onboarding only reach `@AllowOnboarding()` routes; admin routes use `@Roles(...)`. Read the caller with `@CurrentUser()`.
- Controller params validated by `ZodPipe` are typed as `Dto.X` (`import type * as Dto from '@touchgrass/shared'`), see DECISIONS D-024.
- Personal data: every module that stores it registers an `AccountDataContributor` (export + erase) with `AccountDataRegistry`.
- Events: every endpoint returning an event goes through `EventViewService` (mystery-safe); never select `events.location` elsewhere. Seat changes take `withRedisLock(eventLockKey(id))` + `EventStore.core(id, tx, { lock: true })`.
- Discovery lists events via `EventSearchService` (events module) and always re-checks `canViewEvent`; distances/areas use `approx_center`, never `events.location`.
- Dev sign-in: any seeded phone with OTP `000000` (non-production only). Admin: `+91 90000 00001`. Invite code: `GRASS-2026`. Seeded approved hosts: members #3, #6, #9, #12; partner venue staff PIN `2468`.
- Payments: money is confirmed only by signed Razorpay webhooks (worker applies them). With the fake gateway the web checkout page (`/pay/<token>`) has test buttons, and refunds/transfers/KYC settle themselves (`PAYMENTS_FAKE_AUTO_SETTLE`, off in tests). Paid features plug into events via `EventHooks`.
- Mobile tests: `test/fake-api.ts` route table + `test/router-mock.tsx`; call `resetStores()` in `beforeEach`.
- API is ESM (`.js` import suffixes). Shared builds to CJS; rebuild it (`pnpm --filter @touchgrass/shared build`) after changing it.
- Dependencies are pinned exactly; Expo native modules use Expo's `~` ranges.
- After the event (Phase 7): read reliability tiers/cooldowns and host ratings through the DB-only `ReliabilityReaderModule` / `HostRatingReaderModule`; Lore only accepts `ready` media. Seeded members who checked in to the latest finished plan get the "How was it?" prompt at sign-in; Maestro flows signing in as seeded members run `subflows/skip-after-prompt.yaml` after Verify.
- Engagement (Phase 8): crews/votes create plans via `EventsService.create` + `grantInvites` (never insert events); gamification reads only its facts ledger (record facts from domain events, never query other modules); referral credits and passes go through `PaymentCredits` / `RsvpService.jumpWaitlist`. Seeded member #2 is in two crews, has a plan vote, a rewarded referral (2 passes, 1 credit) and squad members free now; crew sessions are generated by the hourly `crews.generate-sessions` job (or immediately when an admin saves a schedule).
- Safety (Phase 9): content modules screen text with `ModerationService.screen` + `flagText` (hold, don't reject, except names/labels), check `SanctionsReader.assertCanPost` before posting, and register a `ModerationTargetRegistry` handler (preview/release/remove) for anything that can be flagged or reported; held rows carry `held_at` and are hidden from everyone but their author. Seeded member #2 has two trusted contacts; members #4/#5 have selfies in the verification queue (re-seeding refills it while they stay unverified); member #8's bio is held. Live links are HMAC-signed (`SIGNED_URL_SECRET`), never stored.
- Notifications (Phase 10): never call `PushDispatchService` directly; use `NotificationsService.notify(userIds, kind, params, { collapseKey })` with a kind from `NOTIFICATION_TEMPLATES` (shared). Params are data rendered at read time (strings, numbers, `{ at }`, `{ t: key }`, `{ en, te, hi }`); add a template + i18n keys in all three languages for any new kind. Reminders claim `(user, ref, kind)` in `reminder_log` before sending. Seeded member #2 has inbox items. Mobile reads flags with `useFlag(key)`, uses `expo-calendar/legacy` for the device calendar, and only persists query roots listed in `src/lib/query-persist.ts`. Client analytics names must be in `CLIENT_ANALYTICS_EVENTS`.
- Admin & cities (Phase 11): guard admin routes with `@Roles(...ADMIN_SECTIONS.<section>)` (shared matrix, also drives the web nav) and check `AdminScopeService` for anything with a city (curators act only in their cities). Record an audit entry in the change's transaction; `AuditTrailInterceptor` logs a generic one for any admin write that doesn't. Cities are a leaf module (never import profiles/events/notifications/account into it). Tests live in Hyderabad (`cityAndHood` picks it by slug); Bengaluru (beta) and Visakhapatnam (waitlist) are seeded too. Seeded curators: member #30 (Hyderabad), #31 (Bengaluru); members #195–#199 wait for Visakhapatnam. Plan times show in the plan's city zone (`event.timezone`).
- Hardening (Phase 12): reference data read on hot paths (taxonomy, city zones, neighbourhood names) comes from per-process `Snapshot`s (`common/cache/snapshot.ts`); call `invalidate()` in any admin write that changes it. `API_WORKERS` runs several API processes per container, so keep the API free of in-process shared state. Playwright migrates and seeds its own `<db>_e2e` database and flushes Redis DB 15 each run (never the dev data). Mobile `__tests__/a11y-audit.test.ts` fails on pressables without role+label, unlabelled inputs/images, or raw RN `Text`; te/hi strings must be in their own script (`i18n.test`, allow-list for brand/language names). Form fields use the `inputBorder` token (`border-input` on web). Empty env values count as unset. Store review sign-in: `STORE_REVIEW_PHONE` + `STORE_REVIEW_OTP`. New app permissions need a purpose string in `app.config.ts`.
- Design (D-144): matcha tokens in `packages/shared/src/tokens.ts` (app is dark-only; web has a light variant), Inter loaded in the root layout (`src/theme/fonts.ts`; the kit `Text` maps weight → family, so set `fontWeight`, never `fontFamily`). Kit adds `Card`, `Pill`, `IconButton`, `Icon`, `IconText`. No emoji in UI or copy (D-145). Icons are our own set (D-146): add or change a glyph in `components/icons/glyphs.ts`, export it from `components/icons/index.tsx`, render with the kit `Icon` (`react-native-svg`, incl. `SvgXml`, is stubbed in `jest.setup.ts`). Tabs use the custom `DockTabBar` (Explore/Plans/+Plot/Chats/Squad; testIDs `dock-<tab>`, `dock-plot`); Profile opens from `open-profile` on Explore, Settings from `open-settings` on Profile; sign-in lands on `/discover`.
- Dates inside reason copy use the `istDate` i18next formatter (registered in `apps/mobile/src/i18n/i18n.ts`); pass a `Date`.

## Phase workflow

Build phases in order (spec section 9). At the end of each phase run every gate (types, lint, unit+coverage, integration, web e2e, mobile tests), update `docs/FEATURES.md` (columns + gate log), `docs/A11Y.md`, `docs/DECISIONS.md`, then summarise.
