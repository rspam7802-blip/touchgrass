# Test server on Oracle Cloud (free)

Runs the whole TouchGrass stack on one free Oracle Cloud machine so friends can test the app without your
laptop. Test mode: no real SMS (each tester gets their own sign-in code), no real payments (the checkout page
has test buttons), sample Hyderabad places for search. For the real launch use `infra/terraform` (AWS).

What runs here: PostgreSQL + PostGIS, Redis, S3-compatible storage (RustFS), the API, realtime, worker, the
website (share pages, fake checkout, admin console) and Caddy for HTTPS with free certificates.

## 1. Create the Oracle account

1. Go to <https://signup.cloud.oracle.com> and sign up (a card is needed for identity; Always Free resources
   are not charged).
2. **Home region: India South (Hyderabad)** (or India West (Mumbai)). This cannot be changed later.
3. Optional but recommended once you're in: upgrade to **Pay As You Go** (Billing → Upgrade). You still pay
   nothing within the Always Free limits, and Oracle stops reclaiming "idle" free machines.

## 2. Create the server

1. On your Mac, make an SSH key if you don't have one: `ssh-keygen -t ed25519` (press Enter for the defaults),
   then `cat ~/.ssh/id_ed25519.pub` and copy the line.
2. Oracle Console → **Compute → Instances → Create instance**.
   - Name: `touchgrass-staging`
   - Image: **Canonical Ubuntu 24.04**
   - Shape: **Ampere → VM.Standard.A1.Flex**, **4 OCPUs, 24 GB memory** (Always Free).
     If it says "out of capacity", try another availability domain, or 2 OCPUs / 12 GB, or try again later.
   - Networking: create a new VCN with a public subnet, **Assign a public IPv4 address: yes**.
   - SSH keys: **Paste public keys** → paste the line from step 1.
   - Boot volume: 100 GB (free up to 200 GB).
3. Create, wait until it's **Running**, and note the **Public IP address**.

## 3. Open the web ports (two places)

1. Oracle Console → the instance → **Subnet** → **Default Security List** → **Add Ingress Rules**:
   source `0.0.0.0/0`, TCP, destination port `80`; and again for port `443`.
2. On the server (step 4 logs you in), Ubuntu on Oracle also blocks them in its own firewall:

   ```bash
   sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 80 -j ACCEPT
   sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 443 -j ACCEPT
   sudo netfilter-persistent save
   ```

## 4. Log in and install Docker

```bash
ssh ubuntu@<PUBLIC_IP>
```

```bash
curl -fsSL https://get.docker.com | sudo sh && sudo usermod -aG docker ubuntu && exit
```

Log in again (`ssh ubuntu@<PUBLIC_IP>`) so the docker group applies, then check: `docker run --rm hello-world`.

## 5. Get the code

The repository is private, so make a read-only token: GitHub → Settings → Developer settings → Fine-grained
tokens → only this repository, **Contents: Read-only**. Then:

```bash
git clone https://<YOUR_GITHUB_USERNAME>:<TOKEN>@github.com/rspam7802-blip/touchgrass.git && cd touchgrass/infra/staging
```

## 6. Create the settings

Pick a 6-digit code for each tester (not `000000`). Put yourself first, and the seeded admin account
`+919000000001` with a code of its own if you want the admin console:

```bash
./setup.sh <PUBLIC_IP> <your email> "+91XXXXXXXXXX:123456,+919000000001:654321"
```

It prints your addresses (`https://api.<ip>.sslip.io` and so on) and writes `.env` with fresh random secrets.
Keep `.env` private; it never goes to GitHub.

## 7. Build and start

Building the images takes about 10 to 20 minutes the first time.

```bash
docker compose build
```

```bash
docker compose up -d postgres redis objectstore mailpit
```

```bash
docker compose run --rm migrate && docker compose run --rm storage-init && docker compose run --rm seed
```

```bash
docker compose up -d
```

Check (give Caddy a minute to get certificates):

```bash
curl https://api.<ip-with-dashes>.sslip.io/v1/health
```

Open `https://app.<ip-with-dashes>.sslip.io/admin` and sign in with the admin number and its code.

The seed adds demo plans, venues and 200 sample members for testers to see. Sample members can't be signed into
(their codes only appear in the server log).

## 8. Put the app on testers' phones

On your Mac, in `apps/mobile/eas.json`, set the **preview** profile's three URLs to your server:

```json
"EXPO_PUBLIC_API_URL": "https://api.<ip-with-dashes>.sslip.io",
"EXPO_PUBLIC_REALTIME_URL": "https://rt.<ip-with-dashes>.sslip.io",
"EXPO_PUBLIC_WEB_URL": "https://app.<ip-with-dashes>.sslip.io"
```

- **Android (free):** `npx eas-cli build -p android --profile preview` → share the link it prints; testers
  install the APK.
- **iPhone, for now:** Expo Go. Put the same three URLs in `apps/mobile/.env`, run
  `npx expo start --tunnel` on your Mac and share the QR code (only the app's code comes from your Mac; all data
  is on the server). For an installable iPhone build use TestFlight (needs the Apple Developer Program).

Testers sign in with their number, their code, and the invite code (`GRASS-2026` from the seed, or create
codes in the admin console).

## Everyday tasks

| Task                                              | Command (in `touchgrass/infra/staging`)                                                                       |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| Add a tester                                      | Edit `TEST_LOGINS` in `.env`, then `docker compose up -d api realtime worker`                                 |
| See someone's sign-in code (not in `TEST_LOGINS`) | `docker compose logs api \| grep "OTP for"`                                                                   |
| Update to the latest code                         | `git pull && docker compose build && docker compose run --rm migrate && docker compose up -d`                 |
| Logs                                              | `docker compose logs -f api` (or `worker`, `realtime`, `web`, `caddy`)                                        |
| Restart everything                                | `docker compose restart`                                                                                      |
| Daily backup                                      | `crontab -e`, add `0 3 * * * /home/ubuntu/touchgrass/infra/staging/backup.sh >> /home/ubuntu/backup.log 2>&1` |
| See emails (receipts are captured, never sent)    | `docker compose exec mailpit wget -qO- http://localhost:8025/api/v1/messages`                                 |

## Safety notes

- The `000000` shortcut is **off** here (`OTP_DEV_BYPASS=false`): only numbers in `TEST_LOGINS` can sign in,
  each with its own code, so testers can't sign in as each other.
- Payments are fake; nobody can be charged.
- Free certificates come from Let's Encrypt via `sslip.io` names; for a nicer address, point a domain's DNS
  `A` records (`api.`, `rt.`, `app.`, `media.`) at the server and change `BASE_HOST` in `.env`.
