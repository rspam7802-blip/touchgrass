# Decisions log

Ambiguities resolved during the build, newest last. Each entry: context → decision → consequence.

## D-001 TypeScript 5.9, not 6.x/7.x

TypeScript 7 (native port) and 6.x are out, but `typescript-eslint` supports `<6.1` and Expo/Nest tooling is validated on 5.x. **Use 5.9.3 everywhere.** Revisit when typescript-eslint supports 7.

## D-002 The API is an ESM package

NestJS 12 ships ESM-only. `apps/api` uses `"type": "module"`, `NodeNext` resolution and `.js` import suffixes. Tests run through SWC (`unplugin-swc`) so decorator metadata is emitted. `packages/shared` compiles to CommonJS, which Node, Metro and Next all consume.

## D-003 Express platform for Nest

Express 5 has the widest middleware compatibility (Helmet, Socket.IO, Razorpay raw bodies). The p95 targets are reachable with horizontal scaling; Fastify can be swapped in later behind `bootstrap.ts` if load tests show a need.

## D-004 RustFS instead of MinIO for local S3

MinIO stopped publishing container images (Docker Hub and Quay). The storage adapter is plain S3 (AWS SDK v3), so any S3-compatible server works. **docker-compose and Testcontainers use `rustfs/rustfs:1.0.4`** (Apache-2.0, S3 API). Buckets are created by `storage:init` instead of the `mc` client. Production uses real S3 + CloudFront.

## D-005 Hand-written reversible SQL migrations

The spec requires versioned _and reversible_ migrations; drizzle-kit does not generate down migrations. Migrations live in `apps/api/migrations/NNNN_name/{up,down}.sql`, applied by `src/infra/database/migrator.ts` under a Postgres advisory lock, one transaction per migration, with SHA-256 checksums so edited migrations are rejected. Drizzle is used for typed queries only (schema in `src/infra/database/schema`). An integration test runs up → down (all) → up on every CI run.

## D-006 Access tokens: HS256 JWT built on `node:crypto`

Access tokens are 15-minute HS256 JWTs (`src/common/auth/jwt.ts`). Refresh tokens (Phase 1) are opaque random values stored as peppered hashes, so a JWT library is unnecessary. Secret: `JWT_ACCESS_SECRET` (Secrets Manager in AWS).

## D-007 pnpm `node-linker=hoisted`

React Native/Metro and several Expo config plugins still assume a flat `node_modules`. Hoisting avoids symlink resolution bugs; strict peer isolation is traded for build reliability.

## D-008 ESLint 9 (not 10)

`eslint-plugin-react`, `-jsx-a11y` and `-react-native-a11y` do not yet declare ESLint 10 support. ESLint 9.39 with flat config. `eslint-plugin-react-native-a11y` declares `<=8` as a peer but works with flat config (`all` ruleset enabled).

## D-009 Test-file lint relaxations

In `*.test.ts(x)` and `test/**` only, the `no-unsafe-*`, `unbound-method`, `no-confusing-void-expression` and `no-non-null-assertion` rules are off (supertest bodies are untyped JSON; vitest/jest mocks are unbound). `no-explicit-any`, floating promises and the TODO/FIXME ban stay on.

## D-010 Accepted audit advisory GHSA-mrhx-c7xc-m3w5

Only reachable through `@expo/cli`'s bundled zod 3.x (a developer CLI, not shipped in the app or run on servers). No patched 3.x exists. Ignored in `pnpm-workspace.yaml` `auditConfig`; our code uses zod 4.6.7. Re-check on each Expo SDK upgrade.

## D-011 API coverage counts unit + integration suites

Gate 3 (≥85% lines on `apps/api/src`) is measured with `vitest run --coverage` over both projects, because adapters/infra are exercised against real Postgres/Redis/S3 rather than mocks. Entry points (`main.ts`, `realtime.ts`, `worker.ts`), CLIs and telemetry bootstrap are excluded.

## D-012 Sliding-window-log rate limiter in Lua

One Redis sorted set per bucket, trimmed atomically in a Lua script: exact limits under concurrency across instances (verified: 50 concurrent requests against a limit of 10 → exactly 10 allowed). Bucket keys hash any body-derived identifier (e.g. phone numbers never appear in Redis).

## D-013 Presigned POST (not PUT) for uploads

A presigned POST policy lets S3 enforce `content-length-range` and `Content-Type`, so the size/type limits in `LIMITS.upload` are enforced by the store, not only the client.

## D-014 Idempotency stored in Redis for 24 h

Keys are scoped per user (or IP when anonymous) and fingerprinted by method + URL + body. Same key + same body → stored response replayed (`Idempotent-Replayed: true`); different body → `IDEMPOTENCY_KEY_REUSED`; concurrent duplicate → `CONFLICT`; handler failure releases the key. Business-level uniqueness (one RSVP per user per event, one ticket per payment) is additionally enforced by database constraints in later phases.

## D-015 Exact dependency pins

All dependencies are pinned to exact versions (Expo-managed native modules use Expo's `~` ranges as `expo install` expects). Upgrades are deliberate PRs.

## D-016 Phase 0 gate applicability

- Gate 6 (privacy) and gate 9 (load) have nothing to test until user data (Phase 1) and the feed/RSVP/chat endpoints (Phases 3–5) exist; their suites are added in those phases.
- Gate 7 Maestro: flows live in `apps/mobile/.maestro` and run in CI on an Android emulator. This build sandbox has no emulator, so Maestro is verified in CI only. The JS bundle is verified locally with `expo export`.
- Gate 11: `pnpm dev` boots infra, migrates, seeds Hyderabad + neighbourhoods and starts api/realtime/worker/web/mobile. The 200 users / 50 venues / 100 events seed grows phase by phase as those tables are created.

## D-017 Web language selection

Public pages pick the language from `?lang=` first, then `Accept-Language`, then English. No cookies are needed for anonymous visitors.

## D-018 Store download CTAs come from env

`NEXT_PUBLIC_PLAY_STORE_URL` / `NEXT_PUBLIC_APP_STORE_URL` are set once listings exist (see LAUNCH_CHECKLIST in Phase 12); buttons render only when configured, so no dead links ship.

## D-019 OTP codes are HMAC-hashed and bound to the number

`otp_requests.code_hash = HMAC(TOKEN_HASH_PEPPER, "otp:<e164>:<code>")`. A leaked table cannot be replayed and a code for one number is useless for another. A new request supersedes the outstanding code. Wrong guesses burn an attempt with a guarded atomic update so parallel guesses cannot exceed 5. Missing an invite does **not** consume the code, so the user can add one and retry without another SMS.

## D-020 Age-blocked accounts keep only the phone hash

A DOB under 18 is never stored. The account's profile, photos and raw phone number are erased; `users.phone_hash` is retained (status `age_blocked`) so the same number cannot sign up again. That is the minimum data needed to enforce the rule.

## D-021 `has-accessibility-hint` lint rule disabled

The rule requires a hint on every labelled element. Apple HIG and Android guidance reserve hints for actions whose result is not obvious; blanket hints make VoiceOver/TalkBack noisier. Hints are added deliberately (toggles, chips, navigation rows, retry). All other `react-native-a11y` rules stay on and caught a real nested-touchable bug in the photo grid.

## D-022 Account deletion: 14-day grace, daily purge

`POST /me/deletion` deactivates immediately (sessions revoked, devices disabled). Signing in during the grace period cancels. The daily worker job (03:17 IST) purges after 14 days, comfortably inside the DPDP 30-day expectation. Purge erases every registered `AccountDataContributor` (later phases register theirs) and leaves an anonymous `users` tombstone so the consent ledger (kept as evidence) and foreign keys stay valid.

## D-023 Profile photos are served through hour-bucketed signed URLs

Bucket objects are private. URLs are presigned with a signing date rounded to the hour (2 h expiry), so a photo's URL is stable for an hour and caches on device and CDN, while access stays revocable. Originals (which may carry EXIF GPS) are deleted after the webp variants are produced. HEIC is converted to JPEG on device because the server image library cannot decode it.

## D-024 Swagger-safe controller parameter types

SWC (used in tests) emits decorator metadata that points at the Zod schema value when a parameter is typed with a name that is both a schema and a type, and Swagger then crashes treating it as a DTO class. Controller parameters validated with `ZodPipe` are typed via a type-only namespace import (`import type * as Dto from '@touchgrass/shared'`, `body: Dto.X`), which every compiler erases to `Object`.

## D-025 Admin dashboard keeps tokens server-side

The admin web never exposes tokens to browser JavaScript: OTP sign-in goes through a Next route handler, tokens live in `httpOnly`, `SameSite=Strict`, path-scoped (`/admin`) cookies, server components call the API, and an expired access token bounces through `/admin/api/refresh`. Accounts without an admin role are refused at sign-in. The Next 16 `proxy.ts` guards every `/admin` route.

## D-026 Social graph and stats ports before their phases

Profiles need mutual friends (Phase 2) and attendance stats (Phases 3/7). Rather than reading tables that do not exist yet, `ProfilesService` depends on the `SocialGraphReader` and `ProfileStatsReader` ports. The Phase 1 implementations stated the truthful facts that no friendships, blocks or events could exist yet. **Update (Phase 2):** the graph port was removed; profiles now use `SocialGraphService` directly. `ProfileStatsReader` and the social `SharedEventsReader` remain until Phases 3/7. Those phases replace the providers; the profile policy and its tests already cover squad/friend-of-friend/blocked cases.

## D-027 Typed routes generated before typechecking

`expo-router` typed routes normally appear only after `expo start`. `apps/mobile/scripts/generate-route-types.cjs` runs Expo's own generator so `pnpm typecheck` (and CI) validate every `router.push` target without Metro.

## D-028 Test-harness realism

Integration tests bind the API to an ephemeral port, trust one proxy hop and give each test client its own `X-Forwarded-For` (production runs behind the ALB), so per-IP limits are exercised realistically without coupling unrelated tests. Simulating "time has passed" for the OTP resend cooldown is done by ageing rows, never by weakening limits.

## D-029 One friendship row per pair

`friendships` stores each unordered pair once (`user_low < user_high`) with the requester and a status. Simultaneous requests from both people therefore meet on one row: the request path takes an advisory lock on the pair and turns a reverse pending request into an acceptance ("mutual pull"). `squad_edges` (a view) expands accepted rows into both directions for the squad, mutual-friend and friend-of-friend queries.

## D-030 Declines are silent and rate-limited by design

A declined request shows the requester "Request sent" for 30 days and does not notify the recipient again. People can't tell they were declined, and can't re-ping someone who said no. Friend requests are also capped at 50/day per user.

## D-031 Blocks are "doesn't exist" everywhere

Every surface treats a block (in either direction) as if the other person did not exist: profiles and squad requests return 404, mutual-friend counts and samples skip them, and suggestions, contact matches and the activity feed drop them. Block sets are cached in Redis for 5 minutes and invalidated for both people on every block/unblock. Reporting is the exception: you can always report someone you blocked.

## D-032 Contact matching stores hashes, replaced on each upload

Only SHA-256 hashes of normalised E.164 numbers are accepted (the schema rejects anything else). Each upload replaces the stored set, so removed contacts disappear. Stored hashes power "they have your number" suggestions in both directions. Members can opt out of being found by number (`discoverableByContacts`); people who opt out are never matched or suggested via contacts.

## D-033 Suggestions are explainable and never random

Suggestions combine mutual friends (diminishing returns), contacts, shared events (Phase 3) and shared interests with weights in `SUGGESTION_WEIGHTS`. Each suggestion carries its reasons. Interest-only candidates need at least two shared interests and must be in the same city, so the feature never degrades into random matching (spec: no swiping, no random matching).

## D-034 Report severity routing and escalation

The category sets the base severity (underage/violence → critical; harassment/hate/nudity/unsafe event → high; scam/impersonation → medium; spam/other → low). Distinct reporters escalate the target one level at 3 and two at 10. One open queue item exists per target, its severity never decreases, and one person reporting the same thing on the same IST day is deduplicated. Reports outlive account deletion but lose the reporter link.

## D-035 Activity is derived from domain events

Feed rows are written by worker handlers from outbox events (`friendship.accepted`, `user.onboarded`; later phases add pull-ups, plots, badges and Lore), keyed by the source event id so redelivery inserts nothing. Reads filter by squad membership, blocks, and the share-activity setting of every person a row mentions. The filtering happens after the keyset scan, which can scan up to five windows to fill a page.

## D-036 Global per-IP limit applies to anonymous traffic only

Indian mobile networks put large numbers of subscribers behind shared carrier-grade NAT addresses, so a per-IP cap on signed-in traffic would throttle unrelated people. The global 600/min per-IP bucket applies only to unauthenticated requests; signed-in requests are limited per user (300/min). Route-specific IP limits that protect anonymous endpoints (OTP request/verify, invite checks, refresh) are unchanged. The full integration run surfaced this when many signed-in test users shared one address.

## D-037 One mystery-safe serializer; the exact spot is a separate read

Every endpoint that returns an event goes through `EventViewService`. The exact location is not part of the cached or passed-around event "core"; it is fetched (`EventStore.exactLocations`) only for events where `isLocationRevealed` says this viewer may see it (hosts always; people holding a seat once the reveal time arrives). Everyone else gets a deterministic approximate centre: HMAC-keyed (with `SIGNED_URL_SECRET`) offset 1–1.5 km from the neighbourhood centroid or the spot, guaranteed ≥1 km and ≤1.7 km from the spot so the 2 km circle always contains it. Deterministic per event, so repeated reads cannot be averaged to triangulate. Outbox payloads and the Redis cache never carry location; self check-in by geofence is refused before reveal so it cannot be used as a distance oracle. Leak tests cover every route plus cache, outbox and the web share page.

## D-038 Invisible plans are 404, not 403

A plan the viewer may not see (blocked host, invite-only without an invite, friends-of-friends outside the graph, women-only for anyone but verified women, drafts) is indistinguishable from a missing one on every endpoint, including RSVP, attendees, invites, tickets and reports. Hosts who are blocked never learn it from an error.

## D-039 Seats reserved for the waitlist; offers are sequential, then broadcast

While anyone is waitlisted, newcomers cannot take a freed seat; it is offered to the next person in line. More than 6 h before the start, offers go one at a time with an exclusive claim window (`waitlist_claim_minutes`, admin setting, default 30) and reserve the seat; a lapsed offer sends that person to the back of the line. Inside 6 h every eligible waiting person is told at once, broadcast offers do not reserve, and the first claim wins (the rest are withdrawn when the plan fills again). A minute-by-minute sweep expires offers and issues new ones, which also switches plans into broadcast mode as they enter the last 6 h.

## D-040 Balanced plans count verified gender only, with three buckets

Balanced plans cap each of `woman`, `man` and `other` at `floor(capacity × share%)`. Only verified gender counts for `woman`/`man`; everyone unverified, non-binary or not saying shares `other`, as do unclaimed guest +1 seats. Someone whose bucket is full joins the waitlist, and promotion skips people whose bucket is still full. Women-only plans are visible and joinable only by verified women; their hosts, co-hosts and member +1s must be verified women too, and guest +1s are not allowed.

## D-041 Hosting needs verification behind a flag; paid plans wait for Phase 6

`require_verification_to_host` (default on) makes plotting require a verified profile (F-SAF-01). Ops can relax it while verification capacity ramps. Plans with a price are refused (`NOT_ELIGIBLE`, reason `PAID_NEEDS_HOST_APPROVAL`) until the host programme and payments land in Phase 6, rather than accepting money flows that do not exist yet. Curated events need a curator/admin role.

## D-042 +1s: squad members or a hashed guest claim link

A member +1 must be in your squad, able to see the plan (being brought counts as an invite; blocks and women-only still apply) and not already on it; both seats are taken atomically or the request fails with `EVENT_FULL` — a +1 is never silently dropped. A guest +1 holds one extra seat on your RSVP and returns a claim link (`/claim/<token>`, token stored peppered-hashed). The link lets a non-member sign up without an invite code and moves the held seat to their new account in the same transaction (no capacity change, so no lock needed). Dropping out releases an unclaimed guest seat; a member +1 keeps their own seat.

## D-043 Share-link invites and "invited by"

Hosts (and people going to public, balanced or friends-of-friends plans) can create share links carrying a hashed token. Opening the plan with a valid token records a personal invite from the link's creator, which opens invite-only/fof visibility for that person and shows "X invited you". When several people invited you, the earliest invite wins. Squad invites only reach your squad; non-squad ids are skipped silently rather than erroring, so the endpoint cannot be used to probe who exists.

## D-044 Check-in tickets are signed, not stored

QR tickets are `tg1.<event>.<user>.<HMAC>`; hosts scan, the API verifies the signature and that the person is going. Tickets work offline once loaded and cannot be forged or replayed at another plan. Self check-in uses a PostGIS `ST_DWithin` (150 m) against the exact spot without returning it. The window is 30 min before to 2 h after the start (or the end). "On time" is within 15 min of the start, for reliability.

## D-045 Interim reliability tier from attendance

Until the full reliability score (Phase 7) the tier shown on profiles is computed from kept commitments: check-ins vs. no-shows (seat held at a completed plan without checking in) and late cancels (within 3 h). Fewer than three commitments is "new". Thresholds: ≥95% super reliable, ≥80% reliable, ≥60% hit or miss, else flaky.

## D-046 Edits are partial and never reset what they did not mention

`UpdateEventBody` is derived from the create schema with every default removed, so a PATCH carrying only a title leaves visibility, mystery, flags and accessibility untouched (a regression test covers this). Only time, place and price changes are "material" and emit `event.updated` to attendees; capacity can never drop below the seats already taken, and raising it offers the new seats to the waitlist immediately.

## D-047 Share-link host and deep links

Share links are `<WEB_PUBLIC_URL>/e/<slug>`. The web app serves `apple-app-site-association` and `assetlinks.json` from env (`APPLE_TEAM_ID`, `ANDROID_SHA256_CERT_FINGERPRINTS`), and the app declares the same host (`EXPO_PUBLIC_LINK_HOST`, default `tg.app`) for `/e/`, `/claim/` and `/invite/`. The share page's "Open in TouchGrass" button uses the `touchgrass://` scheme as the fallback when the OS does not intercept the universal link. Link previews show title, time, neighbourhood (never an address) and host for public/balanced plans, and only "<host> has a plan" for everything else.

## D-048 Feed paging over a short-lived ranked snapshot

A ranked feed cannot use keyset pagination (scores are per viewer and change as plans fill). Each first-page request ranks up to 400 candidates once and stores the ordered ids, scores and reasons in Redis for 5 minutes; the cursor carries the snapshot id and offset. Paging is therefore stable and cheap, and the "cached feed" is the snapshot (reused for an identical first-page request within 60 s; GPS rounded to ~100 m so jitter does not defeat it). When a snapshot has expired the API answers `INVALID_CURSOR` and the app reloads from the top instead of silently mixing two rankings.

## D-049 Discovery measures distance from the public centre

Feed radius, "nearest" ordering, distances on cards and map pins all use `approx_center`, which equals the exact spot for normal plans and is the fuzzed centre for mystery plans. Mystery plans are drawn as their 2 km circle. No discovery surface can therefore be used as a distance oracle for a mystery spot.

## D-050 What the feed leaves out

The feed shows plans you could join: it excludes plans you host, are going to, or are waitlisted for (they live in "Your plans"), plans that already ended, and anything the visibility policy hides. Plans already under way appear only when the time window starts now ("any", "tonight"); "tomorrow" and "weekend" list plans starting in that window.

## D-051 Ranking weights live in code, tuned from logs

`DISCOVERY_WEIGHTS` are constants (reviewed changes, unit-tested monotonicity), not an admin setting: a bad weight change can bury every plan, so it goes through review. Every served item is logged with its score and reasons, and clicks with their position, which is what weight changes are justified against. Reasons are shown when a signal contributes at least 0.75 points.

## D-052 People search shows only full-access profiles

Name search returns someone only when their profile settings would show the viewer the full profile (everyone; friends-of-friends to squad and mutuals; squad-only to squad). Limited profiles stay reachable through shared plans and squads, not by typing a name, and blocked people never appear. Crews join search when crews exist (Phase 8).

## D-053 Weather comes from a per-city hourly cache

The worker refreshes each launched city's 48-hour forecast every hour into Redis (3 h TTL so one failed refresh does not blank the feed); a cold cache is filled on demand. Rain (or ≥60% chance), storms and ≥36 °C favour indoor plans; dry 18–32 °C favours outdoor ones. A provider failure means "no weather", never a failed feed.

## D-054 Append-only logs are monthly partitions

Impression and click logs (and, later, chat messages and notifications) are `PARTITION BY RANGE` on their timestamp with monthly partitions created ahead by `ensure_monthly_partitions` and expired by dropping whole partitions (`drop_monthly_partitions_before`) from a daily worker job. Retention: impressions 6 months, clicks 12 months. Account erasure still deletes a person's rows across all partitions.

## D-055 Chat fans out to user rooms, not conversation rooms

Every socket joins `user:{id}` on connect; the API publishes a message to each recipient's user room (via the Redis emitter, so the API never holds sockets). One subscription covers every chat, the inbox updates without joining anything, and blocked people are filtered out per recipient at send time. `chat:join` only records presence (Redis key, 90 s TTL, refreshed every 60 s) so push is skipped for people looking at the thread.

## D-056 Message de-duplication by client id

The app gives every message a random `clientId` and keeps unsent ones in a persistent outbox. The API claims `(sender_id, client_id)` in `message_client_ids` with `ON CONFLICT DO NOTHING` inside the send transaction and returns the existing message on a repeat, so retries after a lost response or a reconnect never duplicate. Claims are kept 7 days (daily purge); the app never retries older messages.

## D-057 Message ids are UUID v7 and carry their partition

`messages` is partitioned monthly by `created_at`, and `created_at` is derived from the id's UUID v7 timestamp. Lookups by id (replies, reactions, deletes, cursors) compute the timestamp from the id and prune to one partition instead of scanning all of them.

## D-058 Event chat window

A plan's chat opens 24 h before the start (worker job every 10 min posts the opening icebreaker), is writable until 48 h after the end, then read-only; a cancelled plan's chat is read-only at once; drafts have none. Members are seat holders (going / checked in) and hosts; waitlisted and interested people are not. Leaving the plan removes you from future messages but history stays readable while you hold a seat.

## D-059 Message requests decline silently

Outside the squad and without a plan together in the last 30 days, the first DM is a request: the sender may send one message until it is accepted. Declining returns 204 and the sender keeps seeing "request sent" — no rejection signal that could be used to harass. Blocking hides the conversation from both sides (404).

## D-060 Read receipts are reciprocal

If you turn read receipts off you neither send nor see them (the same setting as the privacy screen's read receipts). Group chats show unread counts but no per-message receipts.

## D-061 Polls are created by hosts in plan chats

Only hosts (host, co-host, welcome host) create polls in event chats so the chat does not fill with polls; any member votes. Votes take a row lock on the poll so concurrent changes of the same person's choice serialise; a deadline or a host close ends voting (worker closes due polls every 2 min).

## D-062 Find-your-group signals are assigned once, under a lock

A plan's colour + icon is picked the first time anyone asks (from 30 min before the start) avoiding pairs used by plans overlapping in time within 300 m, under a transaction-scoped advisory lock keyed by city so two nearby plans asking at once cannot collide. Colours are spread first (visible from afar), then icons; the API returns machine names so screen readers announce "Blue Wave".

## D-063 The realtime process serves no HTTP routes but health

The realtime app imports feature modules for their services, which would also register their controllers without the API's guards. A middleware answers 404 to every HTTP path except `/v1/health*`, so only Socket.IO (with its own token auth) is reachable there.

## D-064 Phase 4 scheduled jobs fix

`weather.refresh` and `partitions.maintain` were defined in Phase 4 but not registered with the scheduler. Phase 5 registers them and a boot test now asserts the full list of scheduled job ids.

## D-065 A checkout holds the seat as an RSVP status

Paying takes a seat out of circulation for ten minutes. The hold is an RSVP row with status `held`, written under the event lock in the same transaction as the payment row, so seat counts (which include `held`), the waitlist and balanced-gender caps need no second source of truth. `held` is not "going": no chat, ticket or check-in until a verified webhook turns it into `going`. A worker job releases lapsed holds every minute and offers the seat to the waitlist.

## D-066 Only signed webhooks confirm money

The app and the checkout page never confirm a payment. `POST /v1/webhooks/razorpay` verifies the HMAC on the raw body, records the delivery once (provider event id, else a hash of the body) and queues it; the worker applies it idempotently. A sweep job re-queues deliveries that were recorded but never applied. Amount mismatches fail loudly for ops instead of being trusted.

## D-067 Late and duplicate payments are refunded, not rejected

A bank can confirm after the hold lapsed, or the person can pay twice from two tabs. The capture is always recorded (with a receipt), the person gets a seat if one is free, and otherwise — or for a second payment for the same plan — a full refund (`HOLD_EXPIRED` / `DUPLICATE`) is written in the same transaction. Only one checkout per person per plan can be open (`payments_one_open`).

## D-068 Refund policy and cut-offs

Paid plans default to "full refund until 24 h before". Hosts can choose partial (1–99%) or none, with a cut-off up to 7 days. The policy at the moment of cancelling decides (the cancel event carries its timestamp); host cancellations always refund in full. The same pure function (`refundFor`, shared package) gives the app's quote and the API's refund.

## D-069 Platform fee, GST and payouts

The platform fee is an admin setting in basis points (default 10%), snapshotted on each payment. GST (18%) is charged on the platform fee, not on the ticket; ticket prices are inclusive. A payout is created once per completed paid plan after `payout_delay_hours` (default 24) and freezes the ledger: per payment, kept = paid − refunds (including refunds still in flight), fee and GST on what was kept, host share sent as a Route transfer from that payment. Without an active Route account (KYC) the payout waits `on_hold` and is released by the `account.activated` webhook. Gateway fees are absorbed by the platform fee.

## D-070 Paid plans need an approved application and have no +1s

Any verified person hosts free plans (F-HST-01). Selling tickets needs an approved host application (admin or city curator). Paid plans cannot allow +1s (every seat is a ticket) and the price cannot change once anyone has paid or is paying.

## D-071 Checkout runs on a web page opened from the app

Expo managed apps cannot embed Razorpay's native SDK without a custom build, so the app opens `/pay/<token>` (Razorpay Checkout with the UPI block first) in the browser and returns through `touchgrass://payments/<id>`. The token is random, stored hashed, rotates on every request and reads one order. In development the fake gateway lets that page simulate the bank through the real webhook path; the API refuses simulation in production.

## D-072 Receipts and receipt email

Receipts are numbered `TG-<year>-<sequence>` at capture. Email is optional: a receipt address is asked at checkout (or in settings), stored on the user and used for nothing else. The worker emails each receipt at most once (the row is claimed before sending and released on failure so retries work). Payment records are kept for tax law; account erasure detaches them from the person and clears the receipt email.

## D-073 Perk redemption with a venue PIN

Perks show on plans held at partner venues. A person holding a seat gets a pass on the plan's day (midnight IST until 6 h after the end): a QR (a link to `/r/<token>`, token hashed at rest) and a 6-character code. Venue staff confirm with the venue's PIN (hashed with the server pepper). Ten wrong PINs per venue per hour lock that venue's redemptions, whatever the IP, so a 4-digit PIN cannot be brute-forced. Staff see only the first name and group size.

## D-074 Host analytics count distinct daily viewers

"Views" are distinct people opening a plan per IST day (hosts excluded), deduplicated in Redis before a single insert, so repeat opens cost no database writes. Conversion is RSVPs per 100 views. Ratings and feedback themes come from the after-the-event module (Phase 7) through `FeedbackReader`; until then they read as "no ratings yet".

## D-075 Modules extend events through hooks, not imports

Payments, hosting and perks depend on events (holds, cores, access), so events cannot import them back. `EventHooks` lets them register `canHostPaid`, `hasPayments`, `viewerPayment` and `perks`; unregistered hooks answer conservatively (nobody sells tickets, no perks).

## D-076 Reliability: decayed kept share, tiers only

Each commitment in the last year counts with weight `0.5^(age/90 days)`: check-ins as kept, no-shows as missed, late cancellations (within 3 hours of the start) as half missed. Score = kept share × 100, mapped to tiers (super reliable ≥ 95, reliable ≥ 80, hit or miss ≥ 60, flaky below). Fewer than three commitments reads "new" so one bad night does not label anyone. The number itself is never shown: profiles show the tier, and hosts (only) see attendees' tiers to plan for no-shows. The worker recomputes a person when their ledger changes and everyone nightly (`reliability.recompute`, 03:47 UTC) so decay applies without activity.

## D-077 Cooldown after repeat no-shows

Two no-shows within 60 days start a 14-day cooldown from the latest one. It only applies to popular plans (≤ 20% of spots left, or anyone waitlisted), where a no-show costs someone else a seat; quiet plans stay open. The plan page explains the block with its end date (`RELIABILITY_COOLDOWN`, `{{until, istDate}}`), and RSVP returns the same reason with `until`.

## D-078 Feedback window and anonymity

Only people who checked in can leave feedback, from the plan's end for 14 days, and can change it in that window. Hosts see counts, averages and tag counts at once, but written comments only once three people answered, and never with names or per-person ratings. The admin list shows averages and the most common "could be better" tags, not comments.

## D-079 Host ratings

Attendees rate the primary host separately from the plan (optional). A host's average appears on their profile and in discovery only from three ratings. Ranking adds `hostRating × 1.5` where the factor is `(average − 3.5) / 1.5` clamped to 0…1, so only well-rated hosts are lifted (reason "Highly rated host") and unrated or average hosts are neutral rather than penalised.

## D-080 Mutual pull uses the squad request flow

"Pull" records the intent for that plan (`reconnect_pulls`) and sends a squad request through the social graph, so blocks, privacy and request rules stay in one place. When the other person pulls back, their request meets the open one and the graph accepts it: both become squad. Until then the person pulled sees "Pulled you · tap to connect" on their post-event card (and the request in their squad requests); nobody else sees pulls.

## D-081 Post-event prompt

The app asks `GET /v1/me/after` at launch and on every return to the foreground. The API returns the newest plan the person checked in to that ended in the last 7 days and that they have not wrapped up. The app opens it once per session ("Later"); "Done" records the plan as wrapped up so it never comes back. Badges on the card come from `BadgesReader`, empty until gamification (Phase 8) registers.

## D-082 Lore access and visibility

People who checked in and the hosts can add up to 30 photos each; uploads must have passed moderation (`ready`) before they join the album, so nothing unchecked is ever in a Lore or its cover. The album is visible to the plan's people, or — if the host chooses — also to their squads. Blocks hide photos both ways. Uploaders remove their own photos and hosts remove any. Photos can be reported (`lore_media`).

## D-083 Saving Lore photos

Downloads are short-lived (24 h) signed links to the full-size image, minted per request and leaving out photos from blocked people. The app saves through the system share sheet (`expo-sharing`) rather than writing to the photo library, so it needs no extra media-library permission.

## D-084 Collage covers

The worker redraws an album cover as a 2×2 collage of the four newest visible photos (a single photo fills the cover) whenever that set changes (sharp, webp, stored as a generated `lore` media asset), and clears it when the album empties. A plan's own cover is never replaced.

## D-085 Recurrence rules: a supported RRULE subset, evaluated in IST

Crews store a real RRULE string, but only FREQ=DAILY|WEEKLY|MONTHLY, INTERVAL, BYDAY (MONTHLY may use ordinals such as 1SU or -1FR), COUNT and UNTIL are accepted; anything else is rejected at the API. Occurrences are expanded by a small pure function in `@touchgrass/shared` in IST (UTC+05:30, no daylight saving), keeping DTSTART's time of day. This avoids a timezone-heavy dependency and means every accepted rule is one the app can describe in plain words.

## D-086 Crew sessions are ordinary invite-only plans

The crews module creates each occurrence through `EventsService.create` as a `crew_session` hosted by the admin who set the schedule, 14 days ahead (hourly top-up, Redis-locked per crew, `crew_sessions` keyed by occurrence so re-runs create nothing). Active members are invited without notifications (`grantInvites`), new members are invited to sessions already on the calendar. Changing the schedule cancels upcoming sessions nobody but the host has pulled up to and regenerates; sessions people committed to stay. Pausing stops new sessions only.

## D-087 Crew membership

Open crews (`request`) are listed in their city and anyone can ask to join; admins approve. Invite-only crews are invisible to outsiders (404) and admins invite from their own squad. The last admin can't leave or step down while others remain; when an admin's account is erased the longest-standing member takes over, and the last person out archives the crew.

## D-088 Collaborative plans

Invitees come from the organiser's squad. Anyone in the vote can suggest times (in the future), places and activities and vote for as many options as they like until the deadline (30 minutes to 14 days away). The organiser can lock any time; with auto-lock the worker picks the most-voted time still in the future, the most-voted place and the top activity with votes, ties going to the earliest suggestion. Without a time and a place the vote closes as `NO_OPTIONS`. The plan is invite-only, hosted by the organiser and inherits the vote's category (or the winning activity's interest).

## D-089 Free now

Availability lasts 1–6 hours and expires by time (reads ignore expired rows; an hourly job deletes them). The squad gets one push when someone becomes free, not on every edit. "Plan with them" opens the normal Plot flow and invites that friend once the plan exists.

## D-090 A facts ledger drives badges, challenges and recaps

Gamification records one row per person, kind and thing (`gamification_facts`) from domain events, so replays never double count and no rule reads another module's tables. Admin badges combine the supported rule types without code: how many facts (optionally on-time check-ins only), how many distinct values of a field, or the most inside one group. Built-in badges keep their key and rule; names, emoji and on/off are editable. Retired badges stay in collections once earned.

## D-091 Streaks

A week counts when the person checked in during that ISO week (IST). One missed week per calendar month is frozen automatically on Monday if the streak was alive, so nobody has to remember to "use" a freeze. The "streak at risk" push goes out on Saturday at 18:07 IST, at most once per week, and never during quiet hours (22:00–08:00).

## D-092 Challenge progress

Criteria are check-ins in the challenge window, optionally only in a category, only at places the person hadn't visited before the start (venue, or the neighbourhood for pinned spots), only where someone from their squad also checked in, and counted as plans or as distinct venues/neighbourhoods. Crew challenges pool the crew's active members and count each outing once. Completion records a fact (Challenge Champ) and awards the reward badge.

## D-093 Recaps

On the 1st of each month at 09:07 IST the worker writes last month's recap for everyone with a check-in that month (and last year's on 1 January). People are stored as ids and turned into cards when read, so photo links never go stale and later blocks apply. The 9:16 card is drawn in the app and captured with react-native-view-shot for the share sheet.

## D-094 Referral rewards

Each member has a permanent code; a friend who signs up with it passes the invite gate (their "skip the waitlist") and is linked to the referrer. Rewards are granted to the referrer once, at the friend's first check-in, and are admin-configurable: priority passes (default 2), free-entry credits (default 1, each covering plans up to ₹500), and the Plug badge, with a lifetime cap (default 20). Fraud checks: a phone number or device that already earned a reward never earns another (unique indexes on rewarded rows), and signing up on the referrer's own device earns nothing. After erasure the rewarded phone hash and device id stay, unlinked, only to keep those checks working.

## D-095 Spending rewards

A priority pass moves a waitlisted person to the front of that plan's line; the pass is consumed in the same transaction as the move. A free-entry credit pays a whole ticket for plans priced up to its limit: the seat is held and confirmed immediately with a receipt (method `credit`). The host is still paid their full share: because there is no captured payment to split, the payout sends that share as a Razorpay direct transfer from the platform balance. If the ticket is refunded in full the credit comes back; partial refunds don't apply to credits (a ticket isn't money).

## D-096 Flagged text is held, short labels are refused

The text filter (`screenText`, shared) matches whole words after folding case, look-alike digits/symbols, zero-width characters, stretched letters and plurals, in English, Hinglish/Tenglish and Devanagari/Telugu script, plus a few threat phrases. Words that only look bad inside longer ones ("Scunthorpe", "chod do") are not matched. Longer free text that trips it is saved but held: messages, bios, plan titles/descriptions, Lore captions, crew names/descriptions and plan votes are visible to their author (and a plan to its hosts, a crew to its members) with an "under review" note, and an `auto_text` queue item is opened. Display names and plan-vote activity labels are shown everywhere and can't be partially hidden, so a flagged one is refused with a validation error instead. Held plans, crews and votes announce themselves (feeds, invites, pushes) only when released.

## D-097 Moderation goes through each module

Reviewing never touches another module's tables. Each content module registers a `ModerationTargetRegistry` handler (`preview`, `release`, `remove`) for its target type: messages are deleted for everyone, plans are hidden and an upcoming one cancelled through the normal cancellation path (refunds included), Lore photos are removed, crews archived, votes cancelled, bios cleared, images rejected and their files deleted. Taking something down settles every other open item about it. A resolve, its optional sanction and the audit entry share one transaction; cache invalidation, realtime fan-out and the owner's notice run after it commits.

## D-098 Sanctions

Warn (a push with the reason), mute (no messages, plans, Lore, crews or votes until a date; shown in the app as a reason with its end), suspend (signed out everywhere and refused at sign-in until a date) and ban (the same, until lifted). Mutes and suspensions are 1–365 days; the worker lifts expired ones every 5 minutes and restores the account once no ban or running suspension remains. Staff accounts (moderator, admin, super admin, support) can't be sanctioned from these tools. Crew sessions generated on a crew's behalf ignore a mute: it applies to what a person posts.

## D-099 Verification

A pose is picked at random per attempt and must be answered within 15 minutes; each new pose spends one of three daily attempts (the day starts at midnight IST). A ready profile photo is required so there is something to compare against. The automatic face match (best score against any ready profile photo) only helps the reviewer; a failed comparison never blocks a submission. Rejections carry one of five reasons the person sees. After any review the selfie is deleted (data minimisation). Admins can also grant or revoke the badge by hand from the users page; both are audited.

## D-100 Live location links are signed, not stored

The viewer link is `<shareId>.<expiresAtSeconds>.<HMAC-SHA256>` signed with `SIGNED_URL_SECRET`, valid until 24 hours after the share's scheduled end, so a link can be re-sent (WhatsApp) without storing a token. The share row decides what is shown: while active the name, latest fix, a 20-point trail and the plan; once stopped or expired only "stopped sharing". Plan details come from the event view as the sharer sees them, so a mystery spot stays approximate until it is revealed to them. Plans can be shared only by people going (or hosting), from 2 hours before the start to 3 hours after the end.

## D-101 Points while the app is open

Expo can't run JavaScript reliably in the background without a foreground service and extra store review, so the app reports fixes while the share screen is open (every 30 s or 25 m) and says so. Shares end on their own at the chosen time (15 minutes to 4 hours). Points are raw latitude/longitude rows, never queried spatially, so no geography column or GIST index is used.

## D-102 Location retention

The hourly purge deletes points recorded, and shares ended, more than 23 hours ago; run hourly, nothing is kept longer than 24 hours. Trusted contacts are kept until removed or the account is erased.

## D-103 SOS never says no

SOS opens the dialler on 112 first, then posts. The server starts a 60-minute share if none is running, marks it SOS and texts every contact (`sos_alert`) with the link; it ignores the `live_location` flag and answers even with no contacts, so nothing on our side can stand between someone and help. Each text is sent separately and one failed number doesn't stop the rest.

## D-104 One running share

A partial unique index allows one unended share per person, and starts are serialised with an advisory lock per person; a share whose time is up is closed before a new one starts.

## D-105 Helplines

The safety centre lists 112 (all emergencies), 100 (police), 181 (women's helpline), 108 (ambulance) and 1930 (cyber crime) from shared constants, each tap-to-call. "Report a problem" points to the in-context report menus and to the safety team by email.

## D-106 Notifications rendered at read time

The inbox stores a notification's kind and parameters, never rendered text. Parameters are strings, numbers, `{at}` instants, `{t}` translation keys or `{en, te, hi}` user text, and `renderNotification` fills the template in the reader's current language when the inbox is read. Changing language re-labels the whole inbox, and copy fixes reach old notifications.

## D-107 Quiet hours, batching and digests

Each person has one quiet window (default 22:00–08:00 IST, editable or off). Pushes that land inside it are held in `pending_pushes` until it ends; kinds marked `batch` (squad requests, free now, badges) wait for a 10-minute window. The flush job collapses rows that share a collapse key and, when several are left for one person, sends one localised digest ("4 new updates") instead. The inbox entry is always written at once.

## D-108 Urgent kinds skip the hold

Chat messages, cancellations, the 2-hour reminder, waitlist offers, mystery reveals and sanction notices are `urgent`: they are pushed immediately even in quiet hours, because waiting would make them useless. Chat stays out of the inbox (the chat list is its inbox).

## D-109 Reminders are claimed once

Every reminder is claimed by inserting `(user_id, ref_id, kind)` into `reminder_log` before sending, so overlapping scans and replayed events never double-send. The log is pruned after 30 days.

## D-110 The day-before reminder opens the chat

The 24-hour reminder doubles as the "group chat is open" nudge (the plan chat opens a day before), so attendees get one message, not two. The 2-hour reminder is separate.

## D-111 Templates carry their own deep links

Each template names its path (`events/{{eventId}}`, `after/{{eventId}}`, `squad`, …); push payloads carry `url` and `notificationId` so a tap routes and marks that item read.

## D-112 Calendar feed tokens

The private iCal feed URL is `/v1/calendar/<userId>.<version>.<hmac>.ics`, signed with `SIGNED_URL_SECRET`. Resetting bumps the stored version, which revokes every old link. The feed covers plans the person is going to or hosting from 30 days back to 180 days ahead, and gives a mystery plan's area, never its address, until the reveal.

## D-113 Device calendar copies

"Add to calendar" writes through `expo-calendar` (legacy API, which works on both platforms with write-only access on iOS 17+) and remembers the device event id per plan, so edits update the copy and cancellations remove it the next time the plan is opened.

## D-114 Analytics without personal data

Server analytics come from domain events through a fixed map (`TRACKED_EVENTS`); clients may only send an allow-listed set of events (`CLIENT_ANALYTICS_EVENTS`: app opened, screen viewed, share tapped, calendar added/subscribed, notification opened, update prompt and offline shown) in batches of at most 20. Property names that suggest personal data (name, phone, email and the like) and values that look like phone numbers or emails are refused, not scrubbed.

## D-115 Offline cache allow-list

The mobile query cache is persisted to AsyncStorage only for allow-listed roots (`me`, `events`, `discover`, `chat`, `notifications`, `crews`, `proposals`, `app-config`, interests, vibe tags), skipping search and map results, kept for 24 h with a buster bumped when cached shapes change, and wiped on sign-out. Mutations are never persisted.

## D-116 Share pages for profiles and crews

Public profile pages show first name and last initial, verification and a photo only when the person's photo visibility is "everyone". Crew pages exist only for crews that accept requests and are not held. Invite-only crews and anything else 404, so a shared link never leaks more than the app would show a stranger.

## D-117 Feature flag cache generations

Flag writes bump a Redis generation counter instead of deleting the cache key; readers look up the current generation first. A plain delete let a reader that had loaded the old rows just before a write re-cache the stale value for 30 s (seen as a flaky admin toggle).

## D-118 City-scoped staff roles

Admins and super admins act in every city. A city curator acts only in the cities they curate: the API checks it on every curator-reachable route (`AdminScopeService.assertCity`, lists filtered by scope) for cities, events, venues, perks, host applications (by the applicant's home city) and the analytics overview. Moderators and support are not city-bound; their sections hold no city content. Who may open each section lives in one shared matrix (`ADMIN_SECTIONS`) that both the API's `@Roles` and the web navigation read. A page a role can't open shows a no-access note instead of an error.

## D-119 Every admin action is audit-logged

Services keep recording specific entries in the same transaction as their change. On top, a global interceptor wraps every non-GET route that requires an admin role: if the handler succeeded without recording anything, it writes a generic entry (route, ids, non-sensitive request fields; phone, email, PIN, token and secret fields are dropped, long text is cut). It runs inside the idempotency interceptor, so a replayed response isn't logged twice.

## D-120 City waitlist

People pick a city during onboarding. A city still on the waitlist (or a place that isn't on TouchGrass at all, typed by name) puts them on that city's waitlist instead of continuing. They see their place in line, can pick another city or leave. A waitlist city can't be anyone's home city, and plans can only be placed in open (beta or launched) cities. When an admin opens a city, everyone waiting for it, plus anyone who asked for it by name before it existed, is marked notified in the same transaction and told by the worker (`city.launched` → `city_launched`). Their entry stays until they pick the city, which onboarding pre-selects.

## D-121 Recommendation weights are data

The discovery weights moved from code to `ranking_weights` (defaults in shared). Admins set each between 0 and 10 in steps of 0.25, or reset all of them. Reads are cached per generation like feature flags (D-117), so feeds pick up a change within a minute.

## D-122 Featured plans

A curator can pin a published, public, unheld plan in their city to the top of the recommended feed until a time before it ends, with a rank from 1 to 10. Pinned plans still pass every visibility and filter check, come first by rank, and carry a "Featured in your city" reason, so the pin is shown, not hidden. Cancelling a plan unpins it.

## D-123 Curated plans

Curated plans are created from the admin dashboard (or the plot endpoint by curators) and hosted by the staff member creating them. They are published on TouchGrass's behalf, so the selfie-verification requirement for hosting doesn't apply to them; a curator can only place them in cities they curate. Staff can edit and cancel any plan in their cities. Attendees are told and refunded exactly as when a host cancels.

## D-124 Notification wording overrides

Admins can reword any notification kind's title and body per language. An override may only use placeholders that the kind's default wording (in that language or English) or link uses, so nothing renders as an empty gap. Overrides apply wherever the template is rendered (inbox, push, digest head) and are cached per generation.

## D-125 Analytics overview read model

The admin overview reads per-city, per-local-day counters and daily "active" markers kept by the worker from the same domain events that feed product analytics, so no module's tables are queried. Each outbox event is counted once (a Redis marker per event id, for at-least-once delivery). The city comes from the payload, then the plan, then the person's home city. Active markers are personal, kept 90 days and erased with the account. Seeded history is labelled seed data.

## D-126 City time zones

Each city has an IANA time zone. Plan times are shown in the plan's city zone on the plan, on its share page, in calendar files and in notification moments (`{ at, tz }`). Every city so far is in India, so this is IST in practice. The admin dashboard shows times in IST.

## D-127 Team management

Only super admins grant or remove staff roles. Curators need a city; other roles apply everywhere. Removing a role signs that person out of every session, because signed tokens carry roles. The last super admin can't be removed.

## D-128 Cities stay a leaf module

Profiles, events and venues import the cities module, so it imports none of them (or notifications or account). Launch notifications go out from the worker on `city.launched`, and the account module registers the waitlist's export and erasure.

## D-129 Share page polish

Public plan pages carry schema.org Event structured data with the area and city only (never the address, mystery-safe), a canonical URL and hreflang alternates for the three languages, a "Picked by the TouchGrass team" label on curated plans, and times in the city's zone. Private plans emit no structured data.

## D-130 Per-process snapshots for slow-changing reference data

The interest and vibe taxonomy, city time zones and neighbourhood names are read on almost every plan request and change only when an admin edits them. Each API process keeps a 60-second snapshot of them (`common/cache/snapshot.ts`): one load at a time, a failed load isn't cached, and the admin writes that change them invalidate the snapshot in that process. Other processes see an edit within 60 seconds, which is acceptable for labels and names. Event detail went from 28 to 23 queries.

## D-131 Several API processes per container

`API_WORKERS` forks that many API processes sharing the port (`node:cluster`) and replaces any that exit. The API keeps no in-process state that has to be shared (sessions, rate limits, locks and caches that matter are in Redis or Postgres; snapshots are per process by design), so any count works. Terraform sets it from the task's vCPUs. Realtime and the worker stay single-process and scale by task count.

## D-132 Feed hydration reuses the ranking context

Ranking a fresh feed builds the viewer's context (friends, blocks, interests, reliability). Hydrating the page now reuses it instead of building it again, which cut a fresh first page from 45 to 38 queries. Later pages come from the ranked snapshot in Redis, as before.

## D-133 Content-Security-Policy on the web

The web app sends a CSP: scripts, styles and requests from its own origin, images from HTTPS and the media origin, only the OpenStreetMap frame for the live viewer, `frame-ancestors 'none'`, `object-src 'none'`, and `base-uri`/`form-action` limited to the site. Next.js needs inline bootstrap scripts, so `'unsafe-inline'` stays for scripts until we move to per-request nonces; `'unsafe-eval'` is only allowed in development.

## D-134 End-to-end tests use their own database

Playwright's API server migrates and seeds a fresh `<db>_e2e` database on every run and uses its own emptied Redis database (15), so a run never depends on what earlier runs (or manual testing) left behind and never changes the development data. Redis has to be separate too: caches keyed by a generation counter would otherwise serve values that an earlier run cached from a different database.

## D-135 Form field borders are their own token

Input borders use the `inputBorder` token (3:1 against the surface in both themes, WCAG 1.4.11) instead of the decorative border colour. Contrast pairs for text, focus rings and input borders are pinned in `tokens.test.ts`.

## D-136 Translation review is partly automated

Every Telugu string must contain Telugu script and no Devanagari, and every Hindi string the reverse, apart from a short allow-list (brand name, language names, GST, SOS) and strings made only of placeholders. This catches untranslated English and pasted wrong-language text; a native-speaker read is still on the launch checklist for tone.

## D-137 Accessibility rules are checked statically on mobile

A test parses every screen and component and fails if a pressable lacks a role and label, an input or switch lacks a label, an image is neither labelled nor marked decorative, or raw React Native `Text` is used instead of the kit's `Text` (which caps font scaling at 200%). Spread props are trusted, since the kit components that receive them are checked themselves.

## D-138 Crews in search

Search returns crews by name (trigram and substring match on active crews): crews the viewer belongs to and crews anyone can ask to join, never held ones or ones whose creator the viewer blocked. A partial trigram index covers active crews only.

## D-139 Badges appear in the squad activity feed

Earning a badge records an activity item (`badge_earned`) through the activity module's domain event, shown to squad members who can see the person's activity, with the badge name in the viewer's language.

## D-140 Infrastructure as code

Production runs in AWS ap-south-1 (data stays in India) from `infra/terraform`: ECS Fargate for api, realtime, worker and web (one API image runs api, realtime, worker and migrations with different commands), RDS PostgreSQL 16 Multi-AZ with a read replica, ElastiCache Redis with TLS and auth, S3 + CloudFront for media, WAF on the ALB and CloudFront, Secrets Manager under one KMS key, and SES for email. Generated secrets live in an app secret Terraform manages; third-party keys live in a providers secret Terraform creates empty and never overwrites. Admin pages can be limited to office IPs at the ALB. Images use multi-stage builds with production-only dependencies (`pnpm deploy`).

## D-141 Mobile builds and store variants

EAS profiles: development (dev client, simulator/APK), preview (internal distribution) and production (store, auto-incremented build numbers). Non-production builds get a `.development`/`.preview` suffix on the bundle ID and name, so they install beside the store app. The app declares a purpose string for every permission it asks for, asks for no background location, microphone, motion or Face ID, blocks unused Android permissions that libraries add, and turns off Android backups.

## D-142 Production bootstrap and store review sign-in

Production gets reference data (the launch city, neighbourhoods, flags, taxonomy, icebreaker deck) and its first super admin from an idempotent bootstrap command, never the development seed, which refuses to run in production. Store reviewers can't receive SMS, so one configured number signs in with one configured 6-digit code (never the development code); attempt caps and rate limits still apply and no SMS is sent for it. Empty environment values count as unset, so blank keys in the providers secret don't break validation.

## D-143 Account deletion page

`/delete-account` explains the in-app steps, the 14-day grace period (signing in cancels it), what is erased and what tax law keeps, in all three languages. It shows the support address only when `SUPPORT_EMAIL` is set. Google Play requires such a page.

## D-144 The matcha look and the dock

The app's visual design follows the founder's mock: deep forest-black surfaces (`#0B130E`, frosted cards `#142017`), a neon lime accent (`#CCFF00`, dark text on it), Plus Jakarta Sans, photo-led plan cards with the title over the cover, and a bottom dock with a big lime "+" to plot. The app is dark-only; the web keeps a light variant for people whose system is light (lime is unreadable on white, so light uses a deep lime-green `#3D5E0F`). Every text pair still passes WCAG AA (`tokens.test.ts`). The dock holds Explore, Plans, Plot, Chats and Squad; Profile opens from the avatar at the top of Explore and Settings from Profile, and members land on Explore after sign-in. Plan cards stay one button whose label reads every fact; the pills, faces and "Pull up" pill on them are visual only, and pulling up still happens on the plan, where price, questions and approval are handled. The mock's "Squad Lore" reel needs a feed of recent albums the viewer may see, which the API doesn't have yet, so it isn't shown.

## D-145 Icons, Inter and a calmer voice

No emoji in the app's interface or copy. Controls and labels use Lucide line icons (ISC licence, free for commercial use) through the kit's `Icon`, `IconText` and `Pill` components; icons are decorative, so the text or button label still carries the meaning. Badges get a Lucide icon per key (`src/features/gamification/badge-icons.ts`, medal fallback). Emoji stay where people write them: chat reactions and admin-entered catalog data (shown in the admin console only). Ratings read "4.5/5". The typeface is Inter with lighter weights (titles bold, labels semibold); `src/theme/fonts.ts` is the one place to change it. The copy keeps the brand words (Pull up, Plot, Squad, Crew, Lore) and the "Log off. Pull up." tagline but drops slang, jokes and exclamation marks ("Vibes" is now "Mood"). Telugu and Hindi keep their informal register for now.

## D-146 A custom icon set

The app draws its own icons instead of a library set: about 40 original line icons on a 24pt grid with 1.75pt round strokes, and the lime dot from the logo on the icons people use most (explore, plans, chats, squad, bell, pin, date, lock, flame, ticket, medal). Each icon is one SVG string in `apps/mobile/components/icons/glyphs.ts`, rendered with `SvgXml`, and the design preview is generated from the same strings, so the preview is exactly what ships. The dot takes the icon's own colour on lime backgrounds so it never disappears. The find-your-group signal is drawn from its icon name instead of the server's emoji glyph, and the sample data no longer has emoji in chat messages, notes or captions. This replaces the Lucide set from D-145.

## D-147 Free now ping and the plan screen order

Tapping someone in Free now opens a card (their note and until when) with three actions: Ping, Message and Plan together, instead of jumping straight to Plot. A ping is a push to a squad member who is free right now; it needs the squad relation, no block either way and an active free status, and one ping per pair per 30 minutes (Redis `SET NX EX`), plus a per-user rate limit. The worker re-checks the audience before notifying. The plan screen now reads top to bottom as the plan card, the Pull up block, this plan's chat (the latest three messages and Open chat), then the details.

## D-148 Squad social-proof notifications

"N of your squad are pulling up" goes to a viewer who can see the plan (`canViewEvent`), when 3+ of their squad who share their activity are going and the plan starts within 24 hours: once per viewer per plan and at most once an hour across plans (`reminder_log`). "Your squad is outside. Are you?" goes once a day when 2+ squad members who share their activity checked in to any plan in the last 3 hours and the reader has not; it names no plan and no place, so it reveals nothing a mystery or invite-only plan would hide.

## D-149 Squad stories

Stories are photos that last 24 hours. The author picks the audience per story: their squad, or their squad and their squads (friends of friends); there is no follower graph, so stories reuse the relations that already drive plan visibility. `canViewStory` (pure, unit-tested) decides every read: removed and expired stories are seen by nobody; the author sees their own; everyone else needs an active author, no block either way, no hold, and to be in the audience. Not found is returned whenever a story is not visible, so outsiders can't tell it exists. Photos use the normal media pipeline (EXIF/GPS stripped, image moderation, only `ready` photos post). A caption that trips the text filter holds the whole story (only the author sees it) until a moderator releases it. Likes are visible only to the author, together with who viewed; people can't like their own. Authors delete at once (rows and files); moderators take stories down from the queue; expired stories stay hidden for 72 hours so reports filed just before expiry can still be reviewed, then the hourly purge deletes rows and files. The `stories` flag switches posting off and empties the tray. Linking a story to a plan is left out for now: it would need the plan's own visibility check on every read.

## D-150 Story playback and accessibility

Stories move on after 6 seconds, except while paused, while the viewers sheet is open or while a screen reader is on (WCAG 2.2.2). The sides of the photo are labelled Previous/Next buttons, the progress reads "Story 1 of 3", and the like, reply, report, viewers and delete controls are 44 pt buttons with labels. A story is marked seen once per visit as it comes on screen. Reply opens the existing direct chat with the author, so message requests and blocks apply as for any DM.

## D-151 A more spacious, premium layout

The founder found the app crowded, so the design system was loosened rather than individual screens patched: screens get 28 pt between sections and more room at the top and bottom; cards have 20 pt padding, a larger 28 pt radius and a hairline edge; filled buttons are 52 pt pill shapes (ghost buttons stay at the 44 pt minimum); text fields are 52 pt; titles are larger, semi-bold and tightly tracked, body text has more line height, and section labels are widely tracked. On Explore the brand is larger, plan cards have taller photos (220 pt) and 28 pt between them, and the story and Free now rows breathe more. Touch targets, contrast and the 200% text reflow are unchanged.

## D-152 The company logo

The founder's logo (pixel grass over a "touchgrass" wordmark on lime `#E5FB46`) is the app icon, the Android adaptive icon (lime background, artwork inside the safe zone), the splash screen (artwork on lime) and the web favicon and Apple touch icon. Every file is generated from `apps/mobile/assets/brand/logo-source.png` with nearest-neighbour scaling so the pixels stay sharp; the square store icon puts the artwork on a clean lime square, because iOS rounds the corners itself. Inside the app the logo leads the welcome screen (labelled "TouchGrass" for screen readers) and sits beside the name on Explore (decorative there, since the name is written next to it). The app's accent lime moved from `#CCFF00` to the logo's `#E5FB46` so the icon, splash and screens match; every text and control contrast check still passes. Still to do by a designer: a monochrome Android notification icon.

## D-153 Light and dark, a compact scale, and a full-screen map

The app follows the phone's light or dark setting again (`userInterfaceStyle: automatic`); Settings → Appearance can pin Light or Dark for this device (stored locally, like the language). The light scheme is the existing light token set (lime-800 accent for contrast on light surfaces); the status bar follows the theme. After D-151 the founder found text, buttons, icons and cards too large, so the scale was brought down while keeping the calm spacing: body 15, titles 21, buttons and fields 46 pt (still above the 44 pt minimum), 22 pt between sections, card padding 16, plan photos 168 pt, smaller story and Free now avatars, dock and header icons. The map view now fills the whole screen edge to edge (like Ripple Social), with search and the list/map switch floating on a glass bar at the top and the plans in view as a swipeable row of cards at the bottom; the map follows the light/dark theme on iOS. Those cards are real buttons, so the map is never the only way to reach a plan.

## D-154 Motion, and the Plot place search fix

**Search fix.** Search results on Plot (and the Search screen) could not be picked on the first tap: on iOS a tap inside a scroll view while the keyboard is open only closed the keyboard. Every `Screen` (and the chat list) now keeps taps (`keyboardShouldPersistTaps="handled"`) and drags the keyboard away on scroll. The Plot place search also says "Searching places…", shows a no-matches message (with the pin-on-map alternative) and an error when search fails, instead of showing nothing. The API search itself was verified against the dev stack (known venues and Places both return).

**Motion.** Built on React Native's `Animated` with the native driver (works in Expo Go and tests; no new native module), in `components/ui/motion.tsx`: springy press feedback on every kit button, icon button, plan card and the dock's Plot button; plan cards, story rings, Free now faces, notifications, search results and map cards cascade in; plan detail sections rise in order; new chat messages fade in; the Explore feed loads with shimmering card placeholders; story progress bars fill over each story's 6 seconds and hold when paused; likes, the Pull up status and the selected dock tab pop; the Free now bolt breathes. Everything is off with the phone's Reduce Motion setting (things appear in their final state), and nothing that moves on its own carries information that isn't also in text.

## D-155 Explore browses like an events app

Modelled on the scrolling pattern of big Indian events apps (the founder pointed at District), not their branding: when no filter narrows the feed and it has at least three plans, Explore opens with a hero carousel (featured plans first, then the best-ranked, up to five) of large photo cards that snap one at a time with the next card peeking, neighbours shrinking and dimming as you swipe and a sliding page indicator; it moves on every 5 seconds unless the person is touching it, a screen reader is on or Reduce Motion is set. Below it, themed rails scroll sideways with snapping poster tiles: "Your squad is going", "Tonight" (judged in each plan's city zone), "This weekend" and "Good to go solo", each shown only with two or more plans. Then "All plans", the full ranked list as before. Everything is built from the feed already loaded (no new request, the same privacy filtering), every card and tile is a labelled button, and taps log the plan's real feed position. Any active filter returns to the plain list.

## D-156 Comments on plans, and the host's group chat switch

Every plan has a public comments section under it, for anyone who can see the plan: questions for the host and chatter before the day. Reads go through the plan's own visibility (`canViewEvent`), so invite-only, women-only and mystery plans never leak comments to people who can't see them; blocks hide comments both ways. Comments are screened (held for review, visible only to the author, and no host notification until released), muted people can't post, they can be reported and taken down from the moderation queue, and account export/erase covers them. Authors delete their own; any host role deletes on its plan. Cancelled and draft plans don't take comments. Hosts get one batched notification per plan ("X commented on …").

The group chat stays as it was: people holding a seat (on paid plans, only once payment is confirmed) plus hosts, opening 24 h before. Hosts can now switch it off per plan (`chatEnabled`, on by default, editable later); while it is off nobody can open the chat, and people going see a note pointing them to the comments.

## D-157 A calmer Plot screen

The "where" step showed every known venue, every map suggestion and every saved place stacked under the search box. Now: while typing, one short suggestion card (known venues first, then map places, at most five) appears under the field; once a place is picked, only that place shows, with "Change place" to search again; with nothing typed, saved places are a single sideways row. Long choices (categories, visibility, vibes, refund rules, quick times) are sideways-scrolling chip rows instead of wrapped walls, date and time sit side by side, and the map pin is a quiet link. Price is behind a Free / Paid switch: plans start free; Paid appears only for approved hosts (others see one line on how to become one), and the price, the host's share and the refund rules show only after choosing Paid. The group chat switch (D-156) sits in the main form with a one-line explanation; everything else stays under "More options".

## D-158 Sideways browsing everywhere

Following the founder's references (District, BookMyShow, Ripple), browsing is sideways rows rather than long vertical lists. Explore gets a category row under the stories: round tiles ("All", then every interest with an icon for its group) that filter the feed; tapping the selected one again clears it. The Plans tab shows the next plan as a big card, then sideways rows for the rest of what's coming up, what you host and what's done (all three load at once). The Squad tab shows "People you might know" as sideways cards (photo, why, Add) above its lists. All rows snap card by card, cascade in, and every tile is a labelled button or radio.

## D-159 Profile layout

My profile was a profile card followed by ten full-width buttons. Now: the profile card, then one primary "Edit profile" with Share and Settings as icon buttons beside it, the streak card, your upcoming plans as a sideways row, and the rest (invites, host plans, badges, challenges, recaps, referrals, safety) as a two-column grid of icon tiles. Flags still hide challenges, recaps and referrals.

## D-160 No category tiles; every plan scrolls sideways

The founder did not want category tiles (D-158's Explore row is removed; Plot keeps its category picker because every plan needs one). Instead Explore is made only of themed sideways rows, each shown with at least two plans and never when it would hold every plan: Your squad is going, Tonight, This weekend, Good to go solo, Near you (within 3 km), Through friends of friends, Small groups, Free plans, Mystery plans, Popular right now and Picked for you. Plan cards never stack vertically: "All plans" on Explore and plan results in Search are one sideways row of full plan cards (next card peeking, loading more at the end). Filters narrow what goes into the rows; the layout stays the same.

## D-161 A cheap test server, and test sign-ins without SMS

Before launch, testers use a single-machine test server (`infra/staging`: Docker Compose with Caddy for HTTPS on `sslip.io` names; documented for Oracle Cloud Always Free in Hyderabad) instead of AWS. It runs in test mode (fake SMS, payments, maps). The development shortcut that accepts `000000` for any number is now a setting, `OTP_DEV_BYPASS` (on by default for local development), and the test server turns it off; instead `TEST_LOGINS` gives each tester their own number and 6-digit code, so testers cannot sign in as each other or as the admin. `TEST_LOGINS` is refused in production, codes must not be `000000`, and attempt caps and rate limits still apply.

## D-162 Supabase + Railway test server

At the founder's choice, the test server can also run on managed services: Supabase holds only the database (PostgreSQL + PostGIS, in its own free organisation, separate from other projects), and Railway runs the API, realtime, worker, website, Redis and RustFS photo storage (`infra/railway`). Supabase's own Data API is switched off and every grant to its `anon`/`authenticated` roles is revoked (`supabase-lockdown.sql`), because TouchGrass never uses it and it would otherwise expose tables with a public key. Supabase signs database certificates with a private CA, so the API takes the CA from `DATABASE_CA_CERT` and verifies the server (TLS is never downgraded); every entry point (API, worker, migrations, seed, bootstrap) shares one pool factory. Supabase Storage is not used for photos because uploads rely on S3 presigned POST forms; RustFS supports them, as in local development. Email gets a fake adapter (`EMAIL_PROVIDER=fake`, refused in production) that keeps messages and logs only the subject and recipient domain.

## D-163 Launch audit fixes

A pre-launch audit (security, user flows, data lifecycle) led to these rules:

- **A cancelled ticket's payment is released.** When an attendee cancels a paid seat, that payment gets `ticket_released_at` (migration `0016`) whatever the refund, and never backs a seat again: it is skipped for refund quotes, a later cancel and the duplicate-payment check. A payment is refunded as a duplicate only when the person already held a seat before it arrived, so paying again after cancelling is a new ticket even if the release is still on its way. Before this, re-buying could get the new payment refunded as a "duplicate" while keeping the seat.
- **Per-number rate limits use the canonical number.** Rate-limit rules keyed on a body field can normalise it (`normalize`); OTP request and verify limits key on the E.164 number, so `+91 98480…` and `98480-…` share one bucket.
- **Media is read through the content that holds it.** `GET /v1/media/:id` answers only the uploader (upload progress). Everyone else gets photos from profiles, stories, chat and Lore, which apply blocks, audiences and expiry; an old asset id no longer mints fresh links.
- **Held messages stay hidden by id** (`GET …/messages/:id`), as in history.
- **Notifications that quote removed content are withdrawn.** Comment notifications carry the comment id; removing, taking down or erasing the comment deletes them from inboxes and pending pushes (`NotificationsService.withdraw`).
- **Short texts pushed to others are screened, and muted people can't send them.** The free-now note and poll wording go through `SanctionsReader.assertCanPost` and the text screen; flagged words are refused (like names and labels), not held.
- **No orphaned sensitive photos.** Hourly jobs delete verification selfies never submitted and story photos never posted, a day after upload.
- **Sanctions are exported but kept on erasure.** They are part of a person's data download (without the moderator's name) and are deliberately kept after account deletion so a banned person can't return by deleting their account.
- **Production refuses incomplete providers:** MSG91 needs the flow template id (SOS, live location and invite texts), and SMTP can't point at localhost.
- **Legal pages are part of the product.** `/privacy`, `/terms`, `/refunds` and `/contact` (with the Grievance Officer, IT Rules 2021) are rendered from `apps/web/lib/legal.ts`, written to match what the app does, with company details from settings (`LEGAL_ENTITY_NAME`, `LEGAL_ADDRESS`, `GRIEVANCE_OFFICER_NAME`, `GRIEVANCE_OFFICER_EMAIL`). English is the binding version; a lawyer reviews the wording before launch. The app links to them from sign-up and Settings.
- Story posts and plan comments are counted in product analytics (ids only).

## D-164 Video stories

Stories can be a photo or a video of up to 15 seconds (M4 of `PLAN_PHASE_13.md`). Videos are allowed only for stories, up to 30 MB, as MP4 or QuickTime (what phones record). The worker re-encodes every video with ffmpeg and never serves the upload: H.264 High/AAC MP4, short side at most 720 px, at most 15 s, the phone's rotation applied to the pixels, all container metadata and chapters dropped (phone videos carry GPS), `+faststart` so playback starts while downloading. ffmpeg and ffprobe read only the local file (`-protocol_whitelist file`) and each step has a 2-minute timeout, so a crafted upload can't make the worker fetch URLs, read files or hang. Anything that isn't an ISO media file with a video track, or runs longer than 15 s, is rejected. The first frame becomes the poster (the usual three image sizes, so trays and moderation previews work unchanged) and three frames across the clip go through image moderation; any flagged frame holds the video for review. The video's length is stored (`media_assets.duration_ms`, migration `0017`) and the story viewer shows a video story for exactly that long. The app picks videos from the library only (the picker can trim to 15 s); in-app recording would need the microphone, which the app deliberately does not request. The worker task has 2 vCPUs for transcoding.

## D-165 Lean launch without a company

The founder launches as an individual and spends as little as possible. Each paid or company-only service gets an option that is allowed in production:

- **Free plans only:** `PAYMENTS_PROVIDER=disabled`. Nobody can sell tickets: host applications are refused (`TICKETS_OFF`), paid plots are refused, payment webhooks are rejected, `HostStatus.ticketsEnabled` is false and the hosting screen explains paid plans come later. Free plans work unchanged. Razorpay stays available for when a company exists.
- **Weather:** `WEATHER_PROVIDER=open-meteo` (no key; Open-Meteo's free tier is non-commercial, so a commercial deployment sets `OPEN_METEO_API_KEY` for their paid API) or `none` (no weather shown).
- **Photo checks:** `MODERATION_PROVIDER=google-vision` (SafeSearch; holds likely nudity or violence and very likely racy photos), so the Google project used for sign-in and maps also checks photos and AWS isn't needed. Google Vision cannot compare faces; verification selfies are matched by the reviewer, as face matching only ever assisted them.

## D-166 Firebase phone sign-in and no server SMS

Indian SMS sending requires DLT registration, which needs a business. Instead Firebase Authentication texts and checks the sign-in code on the phone, and the app sends the resulting ID token to `POST /v1/auth/phone-proof`. The API verifies it itself (RS256 against Google's published keys, issuer and audience = our Firebase project, unexpired, a phone sign-in, code entered within 15 minutes), accepts each proof once (Redis, until the token expires), takes the phone number only from the proof, and then follows exactly the same rules as our own codes (blocks, invite gate, new or returning account, session). `PHONE_AUTH_PROVIDER=firebase|fake|none` (fake refused in production).

`SMS_PROVIDER=none` means the server sends no texts; it requires a phone auth provider. Our own codes then work only for `TEST_LOGINS` and the store review number. SOS and live-location shares still start and return the signed link with zero contacts texted, and the app opens the phone's Messages app pre-filled with every trusted contact and the link, so safety never depends on a paid SMS service.

The app includes React Native Firebase only in builds made with the Firebase config files (EAS file variables `GOOGLE_SERVICES_JSON`, `GOOGLE_SERVICE_INFO_PLIST`; iOS then links static frameworks). Expo Go and builds without them keep using the server's codes. The module is loaded lazily, so Expo Go never touches it.

## D-167 Admin console signs in with Firebase too

With `SMS_PROVIDER=none` (D-166) the API texts no codes, so the website's admin sign-in (which asked the API for a code) would have locked every admin out. The console now signs in the same way as the app when the web service has a Firebase web app configured (`FIREBASE_WEB_API_KEY` + `FIREBASE_PROJECT_ID`, optional `FIREBASE_AUTH_DOMAIN`; public values, read per request): Firebase's browser SDK runs an invisible reCAPTCHA, texts and checks the code, and the console's server route passes only the resulting ID token to `POST /v1/auth/phone-proof`, then applies the unchanged admin-role check and httpOnly cookies. Firebase's own browser session is signed out at once; nothing of it is kept. Without those variables the console keeps using the API's codes (development, tests).

Firebase is loaded on demand from the login page only, and only `/admin/login` gets a widened Content-Security-Policy (Google reCAPTCHA scripts and frames, Firebase identity endpoints); every other page keeps the strict policy (tested). The web service's domain must be listed under Firebase → Authentication → Settings → Authorized domains.

## D-168 Live domain touchgrass.co.in

The launch domain is `touchgrass.co.in` (Namecheap). The website, share links, `/.well-known` app-link files and admin console live on the apex; `api.` is the API, `rt.` the realtime service and `media.` the photo store (Railway custom domains). Every EAS profile now points at these hosts: there is one live server and no staging until it is needed. Mail is sent as `hello@touchgrass.co.in`; the safety address in the app is `safety@touchgrass.co.in` (forwarded to the team's inbox).

## D-169 Landing page and public launch waitlist

The website's home page is now a real landing page (server component, three languages, existing `?ref=` referral code, language switcher, store buttons only when `NEXT_PUBLIC_PLAY_STORE_URL` / `NEXT_PUBLIC_APP_STORE_URL` are set, legal footer): what TouchGrass is, how it works (Find or Plot, Pull up, Meet, Lore), features (plans, crews, squad, chat), safety, why it is invite-only, an invite code checker, a waitlist form and a short FAQ. Copy lives under `landing.*` in the shared i18n files. No images and no third-party scripts, so the strict CSP is unchanged.

- **Invite checker:** a server action calls the existing `POST /v1/auth/invites/check` and shows only valid or not (plus the inviter's name for member codes, as the app already does) and the next steps. Rate-limit and other errors show the shared error copy.
- **Public waitlist:** `POST /v1/public/waitlist` (`@Public`, 10 per hour per address; per address and not per contact so it cannot be used to probe whether someone is listed). Body `LaunchWaitlistBody` (shared): name 1–60, an Indian mobile (normalised to E.164) and/or an email (at least one), city (free text kept as a slug, Hyderabad by default), optional note up to 200 characters, the visitor's language, and consent that must be `true`. The note is length-limited, not screened: only the team sees it. Stored in `launch_waitlist` (migration `0018`), unique per phone and per email; a re-submission updates the entry found by phone (else by email) and only fills in contacts that are empty and not held by another entry, so nobody can take over or overwrite someone else's contact. The answer is the same `{ received: true }` either way. The table is not tied to accounts, so there is no `AccountDataContributor`; removal on request is an admin action.
- **Admin:** new `waitlist` section (`admin`, `support`) at `/admin/waitlist`: newest first with cursors, "not invited yet" by default. Inviting needs the `inviteCodes` roles: it creates a single-use admin code labelled `waitlist`, valid 30 days, through `InvitesService` (the waitlist module never writes `invite_codes`), marks the entry invited and records `waitlist.invite` in the same transaction, then emails the code through the `EmailSender` port in the visitor's language when the entry has an email (best effort: a failed email is logged and the admin still gets the code to send). "Remove" deletes the entry and records `waitlist.remove`.
- **Visitor addresses:** the website forwards the visitor's `X-Forwarded-For` to the API, as the admin sign-in route does, so per-address limits are per visitor only if the API sees that chain with the visitor as the last trusted hop. If the website reaches the API through a proxy that adds its own address (for example a public edge with `TRUST_PROXY_HOPS=1`), every visitor shares the website's bucket for the invite check (20/h) and the waitlist (10/h); so on Railway the web service calls the API over the private network (`API_URL=http://api.railway.internal:4000`); the API listens on all IPv4 and IPv6 addresses for that.

## D-170 EAS Update for the app

Builds carry `expo-updates` pointed at the expo.dev project (`@touchgrass2026s-team/touchgrass`), each EAS profile on its own channel (`development`, `preview`, `production`). JavaScript-only fixes go out with `eas update --channel <channel>`; `runtimeVersion` follows the app version, so a change to native code (a new native module or permission) still needs a new build with a higher version. Updates ship only what is in the repository at that commit; publish them from a clean, pushed checkout.

## D-171 Staff can use the admin console before finishing a member profile

The first super admin is created by the production bootstrap with no profile, so `ActiveUserGuard` blocked every admin route with `ONBOARDING_INCOMPLETE` and the console failed on every page. A user still onboarding may now call a route marked `@Roles(...)` when they hold one of its roles (`isStaffRoute`); `RolesGuard` still enforces the roles, routes their role doesn't cover stay closed, and member routes still require a finished profile.

## D-172 Email through Brevo's HTTPS API

Railway blocks outbound SMTP on plans below Pro, so waitlist invite emails timed out (`Connection timeout`) after holding the admin's request for about two minutes. `EMAIL_PROVIDER=brevo` sends through Brevo's transactional API (`POST https://api.brevo.com/v3/smtp/email`, `BREVO_API_KEY`, 10 s timeout) instead; the sender comes from `EMAIL_FROM` and must be a verified sender in Brevo. SMTP and SES stay available for hosts that allow them.

## D-173 Three photos to join

New members need at least three profile photos (`LIMITS.profile.minPhotos = 3`) before onboarding can finish; the photos step and `onboardingState` both count ready or processing photos. Anyone who finished onboarding under the earlier one-photo rule stays in, and profile editing won't let a member drop below three.

## D-174 "Maybe" is the `interested` RSVP, pencilled in as tentative

The second button on a plan now reads "Maybe" (the stored status stays `interested`, so nothing migrates). Tapping it adds the plan to the phone's calendar as tentative (`Availability.TENTATIVE`), the calendar button is offered for maybes too, and the subscribed feed includes them with `STATUS:TENTATIVE`. Pulling up later turns the same calendar entry into a busy one.

## D-175 Date and time are picked, not typed

Plot uses our own `DateField` (month calendar, Monday first, days before today in IST disabled) and `TimeField` (hour, quarter-hour minutes, am/pm) from `components/DateTimeFields.tsx`. They are plain React Native, so they follow the theme, ship in a JavaScript update and need no native module. The form still stores `DD/MM/YYYY` and `HH:MM` in IST.

## D-176 The logo is the grass mark alone

The app icon, adaptive icon, splash, in-app logo and website icons show the pixel grass without the "touchgrass" wordmark. The icon change reaches phones with the next build, not an update.

## D-177 The logo is alive

`BrandLogo` draws the grass (`assets/brand/grass.png`) on a lime tile and animates it with React Native's `Animated` on the native driver: it grows up from the ground line when it appears, then sways a few degrees in a slow loop. At launch `LaunchAnimation` covers the app in the splash's lime while the grass grows, then fades to the screen underneath, so the system splash hands over without a jump. Both stand still (and the launch cover is skipped) with Reduce Motion. The home-screen icon itself cannot animate: Android and iOS only allow a still image there.

## D-178 Guest preference: everyone, women only or men only

`men_only` joins `women_only` as an event visibility (migration `0019`), and both follow one rule, `genderOnly(visibility)` (shared) with `matchesGenderOnly` in the event policy: only members whose gender a reviewer has verified can see, host, co-host or pull up to such a plan, guest +1s are refused, and the refusal reason is `WOMEN_ONLY` or `MEN_ONLY` (or `VERIFICATION_REQUIRED` for the right gender, unverified). Discovery lists men-only plans only to verified men.

## D-179 Private plans: ask to join, the host approves

A plan with visibility `approval` shows its basics (title, time, area, hosts, how many are going) to anyone who could see a public plan, and nothing that lets someone turn up uninvited: the spot is published as a fuzzed centre exactly like a mystery plan's (`hidesSpot`), the guest list is empty and the chat stays closed until the person is going. Pulling up, or saying maybe, needs a host's yes (`APPROVAL_REQUIRED`).

- **Asking:** `POST /v1/events/:id/join-request` (60 a day) records one `event_join_requests` row per person and plan (migration `0020`) and tells the host and co-hosts once (`join_requested`). The person can take it back while it is pending.
- **Answering:** hosts and co-hosts list the people waiting, oldest first, and approve or decline each. Approving records an invite from that host, so everything that already works for invited people applies: they may pull up, seats and the waitlist are unchanged, and going reveals the spot, guests and chat. They are told (`join_approved`). Declining is final (`JOIN_DECLINED` on a second request) and is not announced.
- A host can still invite people directly; that is the same yes without the request.
- Requests are part of the events module's account export and are erased with the account.

## D-180 SOS from the plan

People going to a plan and its hosts get an SOS button on the plan screen while it is published. It does what SOS always does (one confirmation, dials 112, starts a live share, F-SAF-04) and the text to their trusted contacts (up to three) also names the plan, when it is, and where: the place and address with a maps link when this person can see the exact spot, otherwise only the area. Because the server sends no SMS (D-166), the phone's Messages app now opens by itself with every contact and the message filled in; the button stays for a second try. With no trusted contacts saved, the plan screen says so and links to adding them.

## D-181 A verification selfie is part of profile setup

After adding photos, a new member copies a random pose in a selfie (the existing F-SAF-01 flow) before they can finish setup. Sending it is enough: the account goes live while a reviewer compares the selfie with the photos, and the verified badge (and what depends on it: hosting, women-only and men-only plans) follows on approval. A rejected selfie before setup is finished must be retaken; members who finished setup earlier are not sent back.

Profiles never reads verification's tables: modules register named requirements with `OnboardingChecks` (profiles), and `onboardingState.verification` is true when the check passes. The check is on while the `require_verification_to_join` flag is (default on), so the team can switch the step off from the admin console if reviews back up; the app's step then steps aside. The verification routes are `@AllowOnboarding()`.

## D-182 Every Indian city in the list, more interests, and lists instead of tiles

Migration `0021` adds 80 Indian cities on the waitlist (centre and a rough ±0.12° box each; admins refine bounds before opening one) and 46 more interests across the existing categories, never overwriting a slug that exists. Hyderabad stays the only open city.

Dozens of chips made profile setup crowded, so cities and interests now use `PickList`: one choice per row, a search box for long lists, and headings (open cities before those opening soon; interests under their category). Short single-choice lists (gender, neighbourhood, vibes) keep chips.

## D-183 Search starts with suggestions

The search screen used to be blank until two letters were typed. It now opens with the person's last six searches (kept on the phone only, with a Clear button) and a dozen interests to tap; the same suggestions follow a search that finds nothing. Tapping one searches at once. A search is remembered when it is submitted, picked from a suggestion, or leads to opening a plan or a person.

## D-184 A console that looks the part

The admin console gets a proper shell: a sidebar with its sections grouped under headings (Overview, People, Plans and places, Content, Growth, System), the current section highlighted, and the menu folding under a button on phones. The home page is now an overview: queue counts that need someone today (selfies to review, reports and held content, host applications, waitlist not yet invited), the last 30 days' numbers with a daily chart, then every section the person can open. Each block appears only for roles that can open its section. Shared styles under `.admin-main` give every existing page the same cards, tables and form controls without rewriting them one by one.

## D-185 Telugu that sounds like people talk

The Telugu was rewritten throughout for meaning rather than word for word: informal singular to the person (నువ్వు, చెయ్), the English loanwords Hyderabad actually uses written in Telugu script (ప్లాన్, ఫోటో, పేమెంట్, క్యాన్సిల్, డిలీట్) instead of literary words (చెల్లింపు, తొలగించు, ఐచ్ఛికం), and consistent app terms (ప్లాన్ వెయ్ for Plot, జ్ఞాపకాలు for Lore). Safety copy stays plain and calm; venue-staff strings keep the polite form. Keys and placeholders are unchanged (checked against English). Tests now read Telugu from the resources instead of repeating it, so copy edits don't break them.

## D-186 Every admin form answers

Admin forms used to throw on any refusal from the API, which left an error page with no reason. Every form action now runs inside `guarded()` (`lib/admin-action.ts`): on success it comes back to the same page with "Saved", on a refusal with the API's own reason (or the field problems for invalid input), shown by `AdminNotice` at the top of the console; redirects the work itself makes still happen. Team takes a phone number (any common way of writing an Indian number) or a user ID, and says plainly when nobody has signed up with that number yet.

## D-187 Branded emails

Emails use one layout (`common/email/branded.ts`): a forest header with the logo (served by the website at `/email-logo.png`) and the tagline, a white card with the content, the invite code in a lime-on-forest box, a lime button, and a footer saying why the person got it. Tables and inline styles only, so Gmail, Outlook and phone mail apps show it the same; the plain-text part is still sent. The waitlist invite and the payment receipt use it; any new email should too.

## D-188 About us

The website has an About page (`/about`, linked from the home page header and every page's footer) in English, Telugu and Hindi: why TouchGrass exists, the vision, the mission, four goals (start well in Hyderabad, safety first, free to join, open city by city across India) and the co-founders, Raghuram Srivatsa and Narain Malladi (`FOUNDERS` in shared constants). Copy lives under `landing.about`.

## D-189 Plot, Start a vote and chat, tidied

- **Category is a field, not a row of tiles.** With 79 interests a sideways chip row hid almost everything. Plot and Start a vote now use `SelectField`: it shows the choice and opens a sheet with the searchable, grouped `PickList` (the sheet scrolls and never covers more than most of the screen).
- **"Who can come" on Plot** is a vertical list of all seven options instead of a sideways row.
- **Start a vote** has a title, a one-line explanation and sections (the idea, who votes, when voting closes).
- **Chat:** the message box stays above the keyboard (`KeyboardAvoidingView`, offset by the header), and is a rounded input between a round photo button and a round send button, instead of two text buttons and a labelled field that wrapped onto several lines.

## D-190 Live smoke tests

`apps/web/e2e-live` is a read-only Playwright suite against the real site (`playwright.live.config.ts`, `LIVE_URL` to point it elsewhere). It checks that the home page loads in all three languages, About lists both founders, every legal page and the admin sign-in page load without script errors, an unknown share link is a clean 404, the app-link files and the email logo are served, the API's health checks pass, and photo storage answers. The `Live smoke` workflow runs it every three hours, eight minutes after each push to `main` (time for Railway to deploy), and on demand, and keeps the HTML report for 14 days. It never signs in or changes data. The local suite gains `buttons-admin.spec.ts` for the admin buttons nothing else exercised (adding a neighbourhood and a refused duplicate, template wording and reset, verifying a user, saving a partner venue, dismissing the notice).
