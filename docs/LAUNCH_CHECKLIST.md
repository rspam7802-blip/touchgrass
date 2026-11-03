# Launch checklist

The code, infrastructure-as-code, tests and docs are complete (see `FEATURES.md`). Everything below needs a person: an account to open, a contract or KYC to sign, a registration with a regulator, a design, a legal review, or a production change. Work roughly top to bottom; several items take days or weeks of third-party review, so start those first (marked ⏱).

## 1. Company, legal and compliance

- [ ] ⏱ Company incorporated, PAN/TAN, current account. Needed by Razorpay, Apple, Google and DLT.
- [ ] ⏱ GST registration; then set `seller_gstin` in Terraform (receipts print it, D-069).
- [ ] ⏱ **Privacy policy** reviewed by a lawyer for the DPDP Act 2023: what we collect (`STORE_LISTING.md` → Privacy answers), purposes, processors (AWS, MSG91, Razorpay, Expo, Google Maps, OpenWeather, PostHog, Sentry), retention (14-day deletion grace, live-location 24 h purge, selfies deleted after review, tax records kept), rights and how to use them (in-app export and deletion). Publish it at `https://<domain>/privacy`.
- [ ] ⏱ **Terms of use** reviewed by a lawyer: 18+ only, community rules, host responsibilities, paid plans and the refund policy (D-068), platform fee (D-069), limitation of liability for meet-ups. Publish at `https://<domain>/terms`.
- [ ] Refund and cancellation policy page (Razorpay requires it on the website).
- [ ] Contact page or address on the website (Razorpay and the stores require it).
- [ ] Appoint a **Grievance Officer** and publish the name and contact (IT Rules 2021, and DPDP consent/grievance handling). Decide the response SLA the moderation queue will meet.
- [ ] Choose the support address; set `support_email` in Terraform (shown on `/delete-account` and used as the DMARC report address).
- [ ] Third-party penetration test before public launch (`SECURITY.md` → remaining risks).

## 2. SMS (MSG91) and DLT

- [ ] ⏱ **DLT registration** (TRAI) on a telco portal (Jio, Vodafone Idea or Airtel): principal entity, sender ID (header, e.g. `TCHGRS`), and content templates. Approval takes a few days.
- [ ] Register these templates on DLT and in MSG91 with the same wording:
  - OTP (suggested wording, service-implicit): "{#var#} is your TouchGrass code. It expires in 5 minutes. Don't share it."
  - Flow template used by `MSG91_SMS_FLOW_ID`: live-location share, SOS alert to trusted contacts and invite links (variables as in `apps/api/src/adapters/sms/msg91.sms.ts`).
- [ ] MSG91 account, KYC, credits; put `MSG91_AUTH_KEY`, `MSG91_OTP_TEMPLATE_ID`, `MSG91_SMS_FLOW_ID` in the providers secret.
- [ ] Test delivery to Jio, Airtel, Vi and BSNL numbers from production.

## 3. Payments (Razorpay)

- [ ] ⏱ Razorpay account and **KYC** (business documents, bank account, website with the policy pages above).
- [ ] ⏱ Enable **Route** (linked accounts) for host payouts; hosts complete their own KYC from the hosting dashboard.
- [ ] Live API keys → `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET` in the providers secret.
- [ ] Webhook at `https://api.<domain>/v1/webhooks/razorpay` with a secret you choose → `RAZORPAY_WEBHOOK_SECRET`; subscribe to payment, refund, transfer and account events.
- [ ] One real ₹1 plan end to end in production: pay, receipt email, refund, host transfer.

## 4. Other provider accounts and keys

All go into the providers secret (`terraform output provider_secret_name`) unless noted. Empty values count as unset.

- [ ] Expo: organisation, EAS project (`eas init`) → `EXPO_PUBLIC_EAS_PROJECT_ID` in `eas.json` env; access token with push permission → `EXPO_ACCESS_TOKEN`.
- [ ] Push credentials: APNs key uploaded to EAS (`eas credentials`); FCM v1 service account uploaded to EAS for Android.
- [ ] Google Cloud: Maps SDK for Android/iOS keys restricted to the app IDs and signing certs → `EXPO_PUBLIC_GOOGLE_MAPS_ANDROID_KEY` / `_IOS_KEY` (EAS secrets); Places/Geocoding server key restricted to the NAT gateway IPs → `GOOGLE_MAPS_API_KEY`.
- [ ] OpenWeather key → `OPENWEATHER_API_KEY`.
- [ ] PostHog project (EU host, as configured) → `POSTHOG_API_KEY`.
- [ ] Sentry projects (API, mobile) → `SENTRY_DSN`; `EXPO_PUBLIC_SENTRY_DSN` as an EAS secret.
- [ ] ⏱ AWS SES: request production access (leave the sandbox) for the domain; DKIM and DMARC records are created by Terraform.
- [ ] AWS Rekognition is used in ap-south-1 through the task role; no key needed. Confirm the service quota.

## 5. App stores

- [ ] ⏱ Apple Developer Program (organisation, D-U-N-S number) → `apple_team_id` in Terraform (universal links).
- [ ] ⏱ Google Play Console (organisation account, identity verification).
- [ ] Create the apps: bundle ID / package `app.touchgrass`.
- [ ] Play: download the app-signing key SHA-256 fingerprint → `android_sha256_cert_fingerprints` in Terraform (App Links); service account JSON for `eas submit` saved as `apps/mobile/play-service-account.json` (gitignored).
- [ ] Design work (`STORE_LISTING.md` → Graphics): app icon, adaptive icon, notification icon, splash logo, Play feature graphic; add them to `app.config.ts`.
- [ ] Screenshots in English, Telugu and Hindi (`STORE_LISTING.md` lists the screens).
- [ ] Native Telugu and Hindi speakers read the store descriptions (and spot-check the app).
- [ ] Screen-reader pass on physical devices: VoiceOver (iOS) and TalkBack (Android) through sign-up, discover, plan detail, pull up, chat, check-in and safety, with the largest system font (`A11Y.md` → Phase 12).
- [ ] Privacy nutrition label (Apple) and Data safety form (Play) from `STORE_LISTING.md`.
- [ ] Content rating questionnaires (18+ audience).
- [ ] Store review account: set `STORE_REVIEW_PHONE` and `STORE_REVIEW_OTP` in the providers secret, onboard that account once, put both in the review notes, rotate the code after approval.
- [ ] Builds: `eas build --profile production --platform all`, then `eas submit --profile production` (Play goes to the internal track as a draft first).
- [ ] After approval, set `EXPO_PUBLIC_APP_STORE_URL` / `EXPO_PUBLIC_PLAY_STORE_URL` (landing page and share pages link to them).

## 6. Domain and infrastructure

- [ ] ⏱ Register the domain (the configs assume `touchgrass.app`; change `domain` in Terraform and `EXPO_PUBLIC_LINK_HOST` in `eas.json` if different) and create the Route 53 hosted zone; point the registrar's name servers at it.
- [ ] AWS organisation/account for production (and one for staging), root MFA, SSO for the team, billing alarms.
- [ ] Terraform state bucket (versioned, encrypted) and DynamoDB lock table.
- [ ] Office VPN or fixed egress IPs → `admin_allowed_cidrs` (otherwise `/admin` is open to the internet behind OTP only).
- [ ] On-call email for `alarm_email`; confirm the SNS subscription email.

## 7. Production deployment

Follow `infra/terraform/README.md` → First deployment:

- [ ] `terraform init` with the backend config, `terraform apply -target=aws_ecr_repository.app`.
- [ ] Build and push the `api` and `web` images tagged with the git SHA.
- [ ] `terraform apply -var image_tag=<sha>`.
- [ ] Fill the providers secret, then force a new deployment of all four services.
- [ ] Run the migrate task.
- [ ] Run the bootstrap task with `--super-admin <your number>` (reference data + first admin; the dev seed refuses to run in production).
- [ ] Sign in to `/admin`, add the team, set the curator for Hyderabad, check flags (invite gate on for the beta), create the first invite codes.
- [ ] Smoke test production: sign-up with an invite, onboarding, plot a plan, pull up, chat, check-in with the venue PIN, paid plan, report, account export and deletion, `/e/<slug>` share page and the app opening from it (universal links / App Links).
- [ ] Staging load test at production size (`PERFORMANCE.md` → Prove it) and record the results there.
- [ ] Enable RDS and S3 backups checks: restore a snapshot into staging once.

## 8. Launch day

- [ ] Partner venues onboarded (staff PINs given out) and perks configured.
- [ ] Seed real launch plans with the approved hosts; feature a few.
- [ ] Moderation rota for the first weeks (verification queue, reports, held content).
- [ ] Watch the alarms, Sentry and the admin analytics overview.
