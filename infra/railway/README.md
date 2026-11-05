# Test server on Supabase + Railway

The TouchGrass test server as managed services: **Supabase** holds the database (PostgreSQL + PostGIS), and
**Railway** runs everything else: the API, realtime, worker, website, Redis and photo storage (RustFS, the
same S3-compatible store as local development). Test mode: no real SMS (each tester has their own sign-in
code), no real payments, sample Hyderabad places, emails kept in the log instead of sent.

Expected cost: Supabase free plan ₹0; Railway Hobby about $5–10 a month (usage-based). For the real launch use
`infra/terraform` (AWS).

## 1. Supabase: a separate free organisation and project

1. <https://supabase.com/dashboard> → organisation menu (top left) → **New organization**: name **TouchGrass**,
   plan **Free**. (Keeping it out of other organisations keeps billing and data separate.)
2. In TouchGrass → **New project**: name `touchgrass-staging`, a strong database password (save it in a
   password manager), region **South Asia (Mumbai)**.
3. When it's ready:
   - **Lock it down.** SQL Editor → paste `infra/railway/supabase-lockdown.sql` → Run. The last query must
     return no rows. Then Project Settings → **Data API** → turn **off** "Enable Data API". TouchGrass never
     uses Supabase's auto-generated API; this keeps your tables private.
   - **Connection string.** **Connect** (top bar) → **Session pooler** → copy the URI and put your password
     in it. Remove any `?sslmode=...` from the end.
   - **Certificate.** Project Settings → **Database** → **SSL Configuration** → **Download certificate**.
     Open the file, and turn it into one line with `\n` between lines (on your Mac:
     `awk 'NF {printf "%s\\n", $0}' ~/Downloads/prod-ca-2021.crt`).

The free plan pauses a project after 7 days with no activity; open the dashboard and press **Restore** if
that happens (data is kept).

## 2. Railway: project, Redis and storage

1. <https://railway.com> → sign in with GitHub → **New Project** → **Deploy from GitHub repo** → pick
   `touchgrass`. Railway creates one service; we'll configure it as **api** in step 3. Subscribe to the
   **Hobby** plan when asked.
2. In the project: **+ Create** → **Database** → **Redis**. Leave its name as `Redis`.
3. **+ Create** → **Docker Image** → `rustfs/rustfs:1.0.4`. Rename it `storage`. On it:
   - Variables: `RUSTFS_ACCESS_KEY` = a random name (e.g. `tg` + `openssl rand -hex 8`),
     `RUSTFS_SECRET_KEY` = `openssl rand -hex 32`, `PORT` = `9000`.
   - Settings → **Volumes** → add a volume mounted at `/data`.
   - Settings → Networking → **Generate Domain** (port 9000).

## 3. Railway: the four app services

All four use this repository. For each, open the service → **Settings**:

| Service name | Config-as-code file           | Variables to add                                                                                               | Domain               |
| ------------ | ----------------------------- | -------------------------------------------------------------------------------------------------------------- | -------------------- |
| `api`        | `infra/railway/api.json`      | `PORT=4000`                                                                                                    | Generate (port 4000) |
| `realtime`   | `infra/railway/realtime.json` | `PORT=4001`                                                                                                    | Generate (port 4001) |
| `worker`     | `infra/railway/worker.json`   | none                                                                                                           | none                 |
| `web`        | `infra/railway/web.json`      | `PORT=3000`, `API_URL=https://<api-domain>`, `MEDIA_PUBLIC_BASE_URL=https://<storage-domain>/touchgrass-media` | Generate (port 3000) |

The first service from step 2 becomes `api`. Add the others with **+ Create → GitHub Repo → touchgrass**, then
rename them. For each, set **Settings → Config-as-code → Railway config file** to the path in the table.

## 4. Shared variables

Project → **Settings → Shared Variables**: paste `infra/railway/shared-variables.env` and fill in every
`<...>`:

- `TEST_LOGINS`: each tester's number and their own 6-digit code (not `000000`), yourself first; add
  `+919000000001` with a code if you want the seeded admin account.
- `DATABASE_URL` and `DATABASE_CA_CERT` from step 1.
- Three secrets from `openssl rand -hex 32` (run it three times).
- The domains Railway generated for `api`, `web` and `storage`, and the storage keys from step 2.

Then on each of the four app services: **Variables → Shared Variable** → add all of them.

## 5. Deploy, then add demo data

Deploy the services (Railway deploys on every push to `main`; press **Deploy** the first time). The `api`
service runs the database migrations before it starts.

When `api` is green, add the demo plans, venues and sample people once, from your Mac:

```bash
npm i -g @railway/cli && railway login && railway link
```

```bash
railway ssh --service api
```

That opens a shell inside the running `api` service. Run these two there, then `exit`:

```bash
node dist/adapters/storage/storage-init.cli.js && node dist/seed/seed.cli.js
```

Check: `https://<api-domain>/v1/health` answers, and `https://<web-domain>/admin` lets you sign in with the
admin number and its code.

## 6. The app on testers' phones

In `apps/mobile/eas.json`, set the **preview** profile's URLs:

```json
"EXPO_PUBLIC_API_URL": "https://<api-domain>",
"EXPO_PUBLIC_REALTIME_URL": "https://<realtime-domain>",
"EXPO_PUBLIC_WEB_URL": "https://<web-domain>"
```

- **Android (free):** `npx eas-cli build -p android --profile preview` → share the link; testers install it.
- **iPhone for now:** Expo Go. Put the same three URLs in `apps/mobile/.env`, run `npx expo start --tunnel`
  on your Mac and share the QR code (the data is on the server; your Mac only serves the app's code). For an
  installable iPhone build, use TestFlight (Apple Developer Program).

Testers sign in with their number, their code and an invite code (`GRASS-2026` from the seed, or create codes
in the admin console).

## Everyday tasks

| Task                         | How                                                                                                                 |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| Add a tester                 | Shared Variables → edit `TEST_LOGINS` → Railway redeploys                                                           |
| Someone not in `TEST_LOGINS` | Their code is in the `api` logs (`OTP for +91...`)                                                                  |
| Update                       | Push to `main`; Railway rebuilds and the `api` deploy runs new migrations                                           |
| Logs                         | Each service → **Deployments → View logs**                                                                          |
| Database backups             | Supabase free has none you can restore; for anything you care about, `pg_dump` the session-pooler URL from your Mac |

## Troubleshooting

- **`self-signed certificate in certificate chain`**: `DATABASE_CA_CERT` is missing or not the Supabase
  certificate, or the URL still has `?sslmode=`.
- **`unsupported startup parameter`** from the pooler: tell the developer; the API's 10-second statement
  timeout would need to be set after connecting instead.
- **Redis `ENOTFOUND redis.railway.internal`**: the URL needs `?family=0` (Railway's private network is IPv6).
- **Photos don't load**: `S3_ENDPOINT` and `MEDIA_PUBLIC_BASE_URL` must be the storage service's public
  domain, and `storage-init` must have run.
