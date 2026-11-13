# Performance

Targets (build spec §2): feed and event detail at **p95 < 300 ms at 1,000 requests/s**; chat message delivery **< 500 ms p95**. This document records what was measured, on what, and what it takes to reach the targets in production.

## How to run

```bash
pnpm build
docker compose -f infra/docker/docker-compose.yml up -d --wait
pnpm db:migrate && pnpm db:seed
API_WORKERS=3 TRUST_PROXY_HOPS=1 node --env-file=.env apps/api/dist/main.js
docker run --rm --network host -v "$PWD/infra/k6:/scripts" -e RATE=150 -e VUS=120 grafana/k6:1.4.2 run /scripts/detail.js
```

Scripts in `infra/k6`: `detail.js` (event detail), `feed.js` (feed first + next page, filters, map, search), `rsvp.js` (pull up / drop out on one hot plan, overbooking counter) and `chat.js` (send + history, duplicate counter). Each signs in its own seeded members (one per VU, distinct `X-Forwarded-For`), so per-user and per-IP rate limits behave as they would for real people. Use enough VUs that no member exceeds the per-user limit (300 requests/min); fewer, hotter users measure the rate limiter, not the API. Clear `rl:*` keys in Redis between back-to-back runs.

## Environment of the recorded runs

One 4-vCPU sandbox running **everything**: Postgres 16 + PostGIS, Redis, three API processes (`API_WORKERS=3`), the k6 load generator, and Docker's userland port proxy in front of Postgres and Redis (which alone used about half a core under load). Seed data: 200 members, 100 plans, 50 venues. This is far smaller than production (see the capacity plan), so treat absolute throughput as a lower bound; latency at a given rate is the useful signal.

## Results (Phase 12, 2026-11-02)

| Scenario              | Offered load                     | Achieved  | p95                           | p50    | Errors | Correctness  |
| --------------------- | -------------------------------- | --------- | ----------------------------- | ------ | ------ | ------------ |
| Event detail          | 100 req/s, 120 members           | 100 req/s | 29 ms                         | 16 ms  | 0      | —            |
| Event detail          | 130 req/s                        | 127 req/s | 60 ms                         | 23 ms  | 0      | —            |
| Event detail          | 150 req/s                        | 146 req/s | 189 ms                        | 42 ms  | 0      | —            |
| Event detail          | 200 req/s (over capacity)        | 157 req/s | 1.01 s                        | 686 ms | 0      | —            |
| Feed (+ map + search) | 40 iterations/s ≈ 87 req/s, warm | 87 req/s  | 247 ms ¹                      | 68 ms  | 0      | —            |
| Feed (+ map + search) | 60 iterations/s ≈ 114 req/s      | 114 req/s | 1.16 s                        | 638 ms | 0      | —            |
| RSVP (one hot plan)   | 20 iterations/s = 40 writes/s    | 42 req/s  | 39 ms                         | 24 ms  | 0      | 0 overbooked |
| Chat send + history   | 20 iterations/s                  | 66 req/s  | 24 ms (send), 16 ms (history) | 17 ms  | 0      | 0 duplicates |

¹ Feed runs at the same rate varied between 247 ms and 1.02 s p95 on this shared box (ranking queries compete with everything else for the same four cores); the knee is around 85–90 feed requests/s here.

On this box, event detail meets the 300 ms target up to about **145 req/s**. The feed meets it up to about **85 req/s**, and only on a quiet machine. Chat sends are about 20× inside the 500 ms delivery budget: send p95 is 24 ms, and the realtime fan-out adds one Redis pub/sub hop.

**The 1,000 req/s target is not demonstrated on this hardware.** It is a production-scale target; the plan below is how to get there and how to prove it.

## Re-run after launch features (2026-11-13, D-194)

Same box and scripts; the seed now also has 307 images (plan covers and profile photos), which the Phase 12 seed did not. The first run found the feed at half its old throughput: **every feed and detail response re-signed every image link** because the S3 adapter ignored the hourly `signingDate` the media service passes, so each link was new on every request (CPU spent in the AWS presigner, and phones could never cache an image). Fixed in D-194: links are signed at the hour and reused for that hour per process.

| Scenario              | Offered load              | Before fix: achieved, p95 | After fix: achieved, p95 | p50 after | Errors | Correctness  |
| --------------------- | ------------------------- | ------------------------- | ------------------------ | --------- | ------ | ------------ |
| Event detail          | 100 req/s, 120 members    | 101 req/s, 114 ms (warm)  | 101 req/s, **25 ms**     | 12 ms     | 0      | —            |
| Event detail          | 150 req/s                 | 145 req/s, 570 ms         | 148 req/s, **79 ms**     | 25 ms     | 0      | —            |
| Event detail          | 200 req/s (over capacity) | 154 req/s, 1.25 s         | not re-run               | —         | 0      | —            |
| Feed (+ map + search) | 40 iterations/s           | 43 req/s, 4.34 s          | **87 req/s**, 1.2 s      | 43 ms     | 0      | —            |
| Feed (+ map + search) | 60 iterations/s           | 45 req/s, 5.63 s          | 116 req/s, 1.92 s        | 435 ms    | 0      | —            |
| Feed, one API process | 12 iterations/s           | —                         | 268 ms                   | 26 ms     | 0      | —            |
| RSVP (one hot plan)   | 20 iterations/s           | 43 req/s, 30 ms           | (unchanged)              | 20 ms     | 0      | 0 overbooked |
| Chat send + history   | 20 iterations/s, 30 pairs | 68 req/s, 20 ms / 16 ms   | (unchanged)              | 15 ms     | 0      | 0 duplicates |

After the fix the feed's API process is mostly idle at the measured rates; the remaining feed tail on this 4-core box is the load generator, Postgres and three API processes competing for the same cores, as in Phase 12.

## What Phase 12 changed

| Change                                                                                                                               | Effect                                                                                             |
| ------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------- |
| Event detail: taxonomy, city time zones and neighbourhood names from a 60 s per-process snapshot (`common/cache/snapshot.ts`, D-130) | 28 → 23 queries per detail request                                                                 |
| Feed: the viewer context built while ranking is reused when hydrating the page                                                       | 45 → 38 queries per fresh feed page                                                                |
| `API_WORKERS`: one container runs several API processes sharing the port (`node:cluster`), so a multi-vCPU task uses every core      | Throughput scales with cores; the API keeps no in-process state that breaks with several processes |
| k6: `detail.js` added; feed threshold tightened to the spec's 300 ms; setup probes no longer count as errors                         | Scripts assert the spec's targets                                                                  |

Cost per request, measured with three workers at 157 req/s: about **8–9 ms of API CPU per event-detail request**. Profiling showed the API mostly idle and waiting on Postgres when requests are sequential, so latency under load is dominated by database round trips and contention.

## Capacity plan for 1,000 req/s (production, ap-south-1)

Infrastructure as in `infra/terraform`:

- **API:** ECS Fargate, 2 vCPU tasks, `API_WORKERS=2`, autoscaling on CPU at 60%.
- **Database:** RDS Postgres 16 Multi-AZ writer plus a read replica. Read-heavy services inject `DB_REPLICA`; it falls back to the writer when `DATABASE_REPLICA_URL` is unset.
- **Cache:** ElastiCache Redis.

1. **API CPU:** 1,000 req/s × ~9 ms is about 9 vCPU. With 40% headroom that is ~13 vCPU, i.e. 7 tasks of 2 vCPU (`api_min_count = 3`, `api_max_count = 12`).
2. **Database:** about 23 queries per detail request and 38 per fresh feed page, all index or primary-key lookups except feed candidate ranking (GIST radius over `approx_center`, bounded to 400 candidates). Feed pages after the first come from the ranked snapshot in Redis (5 minutes), and repeat first pages reuse it, so fresh rankings are a fraction of feed traffic. Size the writer at `db.r6g.xlarge` and the replica at `db.r6g.xlarge`, then confirm with the run below before launch.
3. **Prove it:** run the same k6 scripts from a separate load-generator instance in the VPC against staging with a production-sized seed (scale `SEED_USER_COUNT` and plans), at 1,000 req/s for 10 minutes each. Record the results here. The 300 ms thresholds in the scripts fail the run if a target is missed.

## Known hot spots, if staging falls short

- Feed: precompute per-city candidate pools (the 400 nearest upcoming plans per neighbourhood) in Redis on publish/edit instead of per request; rank in memory.
- Event detail: cache viewer-independent parts of the detail (hosts, taxonomy, perks) with the core; only RSVP state and counts are per viewer.
- Mutual-friend counts appear several times per feed page (previews, vias, cards); batch them into one query per page.
