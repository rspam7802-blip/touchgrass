# Phase 13 plan: stories, Free now actions, plan screen, squad notifications

Requested after the matcha redesign, checked against `TouchGrass_Features.pdf`. Every rule in `CLAUDE.md` still applies: new tables only through migrations, modules talk through services and domain events, every endpoint validated with shared Zod schemas, privacy in pure policy functions with unit tests, personal data registered for export and erase, rate limits and idempotency on writes, all copy in English, Telugu and Hindi, no emoji, accessibility audit green.

## What is missing today

| #   | Item                                                                                            | Source                          | Status                            |
| --- | ----------------------------------------------------------------------------------------------- | ------------------------------- | --------------------------------- |
| 1   | "3 of your squad are pulling up tonight" notification                                           | PDF, brand notification style   | Missing                           |
| 2   | "Your squad is outside. Are you?" notification (squad members checked in nearby right now)      | PDF                             | Missing                           |
| 3   | App store subtitle "Plans, people, IRL"                                                         | PDF brand table                 | Changed in the copy pass; restore |
| 4   | Tapping someone in Free now opens a ping card (ping, message, plan together), not Plot          | Mock                            | Wrong behaviour                   |
| 5   | Plan screen: card on top, then Pull up and this plan's chat, then details                       | Founder                         | Chat is at the bottom             |
| 6   | Stories: photos and videos up to 15 s, 24 h, seen by squad or squad + friends of friends, likes | Founder, mock "Squad Lore" reel | New feature                       |

Everything else in the PDF is built and tested (`docs/FEATURES.md`).

## Milestones (each one is tested, documented, committed and pushed on its own)

### M1: Plan screen, Free now card, subtitle (mobile + shared)

- Plan screen order: hero card (cover, title, time, place) → Pull up block → this plan's chat preview (last messages, open chat, icebreaker) → details (description, map, price, perks, hosts, who's going, Lore, host tools). No API change.
- Free now: tapping a person opens a sheet with their note and until-when, and three actions: **Ping** (new, below), **Message** (existing DM), **Plan together** (existing Plot with them invited).
- Ping: `POST /v1/availability/:userId/ping`; allowed only to squad members who are free now and not blocked; rate-limited (one ping per pair per 30 minutes); delivered as a `free_now_ping` notification. Policy function + unit tests + integration tests (non-squad, blocked, not free, rate limit).
- Restore "Plans, people, IRL".

### M2: Squad notifications (API + shared)

- `squad_pulling_up`: when a plan the viewer can see (re-checked with `canViewEvent`) reaches 3+ squad members going and starts within 24 h, notify once per viewer per plan; respects quiet hours, notification settings and members who hide their activity.
- `squad_outside`: when 2+ squad members check in to plans within 3 km of the viewer's area in the same evening, notify once per evening; never reveals an exact location, only the area.
- Driven by existing `rsvp.*` and `checkin.*` domain events through the outbox; dedupe via `reminder_log`. Integration tests for privacy (blocked, hidden activity, invisible plans, mystery plans) and dedupe.

### M3: Stories, photos (API + mobile + admin)

- Data: migration `0014_stories` with `stories` (author, media, caption, audience `squad` | `squad_fof`, optional linked plan, `expires_at` = +24 h, `held_at`), `story_views`, `story_likes` (unique per user and story).
- Policy `canViewStory`: author; or audience includes the viewer (squad, or friend of friend when chosen); never if either side blocked, story held (except author), expired, or author sanctioned. Unit-tested rule by rule.
- API: post, list a viewer's story tray (people with active stories, unseen first), list one person's stories, mark viewed, like/unlike, delete own, author-only viewers and likers list. Cursor pagination, idempotent posts, rate limits (posts per day, likes per minute).
- Safety: captions through `ModerationService.screen` (hold, not reject); images through the existing media pipeline (EXIF/GPS stripped, image moderation); `ModerationTargetRegistry` handler so stories can be reported and removed from the admin moderation queue; `SanctionsReader.assertCanPost`.
- Personal data: `AccountDataContributor` exports and erases stories, views and likes; expired stories and their media are purged by a worker job.
- Mobile: story ring tray at the top of Explore (the mock's reel), full-screen viewer with progress bars, tap to advance, like, reply by DM, report; composer from camera or library with audience choice; author's viewers and likers sheet.

### M4: Stories, video (API + worker + mobile)

- New media kind for video (`video/mp4`, `video/quicktime`, max 30 MB, max 15 s).
- Worker re-encodes every video with ffmpeg to H.264/AAC MP4 720p, which also drops all container metadata (GPS on phone videos), rejects anything longer than 15 s, extracts a poster frame, and runs image moderation on three sampled frames (held for review if flagged).
- Playback with `expo-video`; recording asks for the microphone with a purpose string (`app.config.ts`), library picking does not.
- Terraform: worker task size for transcoding; S3 lifecycle already expires orphaned uploads.

### M5: Gate and docs

- Every gate from `CLAUDE.md`: typecheck, lint, format, unit + coverage (≥ 85%), Testcontainers integration incl. privacy-leak suites for stories, RNTL + a11y audit, Playwright (admin moderation of a story), Maestro flow for posting and viewing a story, k6 smoke for the story tray.
- `FEATURES.md` rows for every new feature, `DECISIONS.md` (D-147+), `ARCHITECTURE.md` index register (story indexes), `SECURITY.md` (video pipeline, story privacy), `A11Y.md`, `CLAUDE.md` notes.

## What does not change

- No follower graph: story audiences reuse the squad and friend-of-friend relations that already drive plan visibility.
- No new external services: video processing runs in our own worker; storage stays S3/CloudFront.
- Existing endpoints and their contracts stay as they are; additions only.
