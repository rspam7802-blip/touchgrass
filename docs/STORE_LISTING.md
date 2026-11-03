# Store listing checklist

Everything the App Store and Google Play listings need, with the copy written and the facts taken from the code. Items marked **☐ human** need someone with the store accounts, a designer or a lawyer; they're repeated in `LAUNCH_CHECKLIST.md`.

## Identity

| Field                              | Value                                                                                                   | Source                                                       |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| App name (both stores, ≤ 30 chars) | TouchGrass                                                                                              | `BRAND.name`                                                 |
| iOS subtitle (≤ 30 chars)          | Plans, people, IRL                                                                                      | `BRAND.storeSubtitle`                                        |
| Bundle ID / package                | `app.touchgrass` (preview and development builds add `.preview` / `.development` and install beside it) | `app.config.ts`, `eas.json`                                  |
| Version                            | 0.1.0; build numbers are incremented by EAS (`autoIncrement` in the production profile)                 | `app.config.ts`, `eas.json`                                  |
| Category                           | Primary **Social Networking** (iOS) / **Social** (Play); secondary **Lifestyle** (iOS)                  | —                                                            |
| Languages                          | English, Telugu, Hindi (app UI and listing)                                                             | `packages/shared/src/i18n`                                   |
| Availability                       | India only at launch                                                                                    | Hyderabad launch; cities beyond it are data (`cities` table) |
| Price                              | Free; paid plans are bought from hosts through Razorpay on the web checkout                             | D-06x payments decisions                                     |

Paid plans are tickets for real-world events, which both stores allow outside in-app purchase (Apple guideline 3.1.3(e), "goods and services outside of the app"; Google Play's payments policy exempts physical goods and services). Keep the store review notes saying so.

## Copy

Keep these in sync with the app's own wording (Pull up, Plot, Squad, Lore, Crew).

### English

- **Promotional text / short description (≤ 80 chars):** Find plans near you, pull up with your squad, and meet people for real.
- **Keywords (iOS, ≤ 100 chars):** meetups,events,hyderabad,friends,plans,social,community,irl,crew,weekend
- **Full description (≤ 4,000 chars):**

  > Log off. Pull up.
  >
  > TouchGrass is for meeting people in real life. Find plans happening near you this week, from run clubs and board-game nights to food walks and open mics, and pull up with your squad or on your own.
  >
  > • Discover plans by neighbourhood, interest and vibe, with friends-of-friends who are going.
  > • Plot your own plan in a minute, keep it small, invite-only or open to the city.
  > • Chat with the people going before you meet, with icebreakers to get things started.
  > • Join crews that meet every week, and save the photos from each plan as Lore.
  > • Safety built in: verified profiles, trusted contacts, live location you choose to share, and one-tap reporting.
  >
  > Starting in Hyderabad. Available in English, తెలుగు and हिन्दी.

### తెలుగు

- **చిన్న వివరణ:** మీ దగ్గరలోని ప్లాన్‌లు చూడండి, మీ స్క్వాడ్‌తో వెళ్లండి, నిజంగా కలవండి.
- **పూర్తి వివరణ:**

  > లాగ్ ఆఫ్. పుల్ అప్.
  >
  > TouchGrass మనుషులను నిజ జీవితంలో కలవడానికి. ఈ వారం మీ దగ్గర జరిగే ప్లాన్‌లు చూడండి — రన్ క్లబ్‌లు, బోర్డ్ గేమ్ నైట్స్, ఫుడ్ వాక్స్, ఓపెన్ మైక్స్ — మీ స్క్వాడ్‌తో లేదా ఒంటరిగా వెళ్లండి.
  >
  > • ఏరియా, ఆసక్తి, వైబ్ ఆధారంగా ప్లాన్‌లు, ఎవరు వస్తున్నారో కూడా చూడండి.
  > • ఒక్క నిమిషంలో మీ సొంత ప్లాన్ ప్లాట్ చేయండి.
  > • కలిసే ముందు వెళ్లేవాళ్లతో చాట్ చేయండి.
  > • ప్రతి వారం కలిసే క్రూలలో చేరండి, ఫోటోలను లోర్‌గా దాచుకోండి.
  > • భద్రత: వెరిఫైడ్ ప్రొఫైల్స్, నమ్మకమైన కాంటాక్ట్‌లు, మీరు ఎంచుకుంటేనే లైవ్ లొకేషన్, ఒక్క ట్యాప్‌తో రిపోర్ట్.
  >
  > హైదరాబాద్‌లో మొదలవుతోంది.

### हिन्दी

- **छोटा विवरण:** पास के प्लान खोजें, अपने स्क्वाड के साथ जाएँ, सच में मिलें।
- **पूरा विवरण:**

  > लॉग ऑफ़. पुल अप.
  >
  > TouchGrass असल ज़िंदगी में लोगों से मिलने के लिए है। इस हफ़्ते अपने आस-पास के प्लान देखें — रन क्लब, बोर्ड गेम नाइट, फ़ूड वॉक, ओपन माइक — और अपने स्क्वाड के साथ या अकेले जाएँ।
  >
  > • इलाक़े, दिलचस्पी और वाइब के हिसाब से प्लान, और देखें कि कौन जा रहा है।
  > • एक मिनट में अपना प्लान प्लॉट करें।
  > • मिलने से पहले जाने वालों से चैट करें।
  > • हर हफ़्ते मिलने वाले क्रू से जुड़ें, फ़ोटो को लोर में सहेजें।
  > • सुरक्षा: वेरिफ़ाइड प्रोफ़ाइल, भरोसेमंद संपर्क, आपकी मर्ज़ी से लाइव लोकेशन, एक टैप में रिपोर्ट।
  >
  > हैदराबाद से शुरुआत।

☐ human: a native Telugu and a native Hindi speaker read both descriptions before submission (the app strings had the same review, see A11Y.md).

## URLs

| Field                             | URL                                                   | Status                                                                                                                          |
| --------------------------------- | ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| Marketing / website               | `https://<domain>/`                                   | Built (landing page)                                                                                                            |
| Support                           | `mailto:` the `SUPPORT_EMAIL` address, or a help page | ☐ human: choose the address and set `support_email` in Terraform                                                                |
| Account deletion (Play, required) | `https://<domain>/delete-account`                     | Built: in-app steps, the 14-day grace period, what's kept, and the support address for people who can't open the app (en/te/hi) |
| Privacy policy (both, required)   | `https://<domain>/privacy`                            | ☐ human: lawyer-reviewed policy (DPDP Act 2023); publish it at this path                                                        |
| Terms of use                      | `https://<domain>/terms`                              | ☐ human: lawyer-reviewed terms                                                                                                  |

## Graphics

None of these exist yet. All are design work (☐ human).

| Asset                       | Spec                                                                                               |
| --------------------------- | -------------------------------------------------------------------------------------------------- |
| App icon                    | 1024×1024 PNG, no transparency (iOS); add `icon` to `app.config.ts`                                |
| Android adaptive icon       | 432×432 foreground on a 108 dp safe zone + background colour `#146A25`; add `android.adaptiveIcon` |
| Notification icon (Android) | 96×96 white-on-transparent PNG; add `icon` to the `expo-notifications` plugin options              |
| Splash                      | Logo PNG for `expo-splash-screen` (background colour already `#146A25`)                            |
| Play feature graphic        | 1024×500 PNG/JPG                                                                                   |
| Play icon                   | 512×512 PNG                                                                                        |
| iPhone screenshots          | 6.9″ (1320×2868) required; 6.5″ (1284×2778) recommended; 3–10 per language                         |
| Android phone screenshots   | 2–8, 16:9 or 9:16, min 1080 px on the short side                                                   |

Screenshot set, per language (seeded data is fine, use the dev stack with `?lang=`-equivalent app language): Discover feed; plan detail with friends going; Plot flow; event chat with an icebreaker; crew page; Lore grid; safety (trusted contacts / live location). Avoid real people's faces and phone numbers.

## Permissions (as the app asks for them)

Purpose strings are in `app.config.ts`; each is asked only in context.

| Permission             | When                                               | iOS purpose string key                                                         |
| ---------------------- | -------------------------------------------------- | ------------------------------------------------------------------------------ |
| Location (while using) | Discover nearby, check-in on arrival               | `NSLocationWhenInUseUsageDescription` (+ temporary full accuracy for check-in) |
| Camera                 | Verification selfie; hosts scanning check-in codes | `NSCameraUsageDescription`                                                     |
| Photos                 | Profile photos, Lore uploads                       | `NSPhotoLibraryUsageDescription`                                               |
| Contacts               | Find friends (hashed on the phone)                 | `NSContactsUsageDescription`                                                   |
| Calendar               | Add a plan to the calendar                         | `NSCalendarsUsageDescription`, `NSCalendarsFullAccessUsageDescription`         |
| Notifications          | After sign-in, explained first                     | —                                                                              |

Not requested: background location, microphone, motion, Face ID. On Android, `RECORD_AUDIO`, `WRITE_CONTACTS`, external storage and `SYSTEM_ALERT_WINDOW` are blocked even if a library adds them.

## Privacy answers

### Apple privacy "nutrition label"

Data **linked to the user**, not used for tracking, no third-party advertising:

| Apple category                       | What                                                                                    | Purpose                                    |
| ------------------------------------ | --------------------------------------------------------------------------------------- | ------------------------------------------ |
| Contact info: Phone number           | Sign-in (OTP)                                                                           | App functionality                          |
| Contact info: Name                   | Display name                                                                            | App functionality                          |
| User content: Photos                 | Profile photos, Lore                                                                    | App functionality                          |
| User content: Other user content     | Bios, plans, messages, reviews, reports                                                 | App functionality                          |
| Location: Precise                    | Check-in at the venue (only at that moment); live location when the user starts sharing | App functionality                          |
| Location: Coarse                     | Nearby plans                                                                            | App functionality, product personalisation |
| Contacts                             | Hashed phone numbers for friend matching                                                | App functionality                          |
| Identifiers: User ID, Device ID      | Account, push token                                                                     | App functionality                          |
| Purchases                            | Paid plan history (card data stays with Razorpay)                                       | App functionality                          |
| Usage data: Product interaction      | Analytics without personal data (PostHog)                                               | Analytics                                  |
| Diagnostics: Crash data, Performance | Sentry                                                                                  | App functionality                          |
| Sensitive info                       | Verification selfie (deleted after review)                                              | App functionality                          |

"Data used to track you": **none**. No IDFA, so no App Tracking Transparency prompt.

### Google Play data safety

- Data is encrypted in transit: **Yes** (HTTPS/WSS only).
- Users can request deletion: **Yes**, in the app and at `/delete-account`.
- Collected (same list as above), **shared** with third parties: **No** (processors such as MSG91, Razorpay, AWS, PostHog and Sentry act on our behalf, which Play does not count as sharing). Payment info is collected by Razorpay, not by the app.
- Optional vs required: phone number and name required; everything else optional.

## Content rating

- Audience: **18+ only** (`LIMITS.minAgeYears = 18`, enforced at onboarding). Play target audience: 18 and over.
- Questionnaire answers: user-generated content and user-to-user communication **yes**, with reporting, blocking and moderation; location sharing between users **yes** (opt-in live location); no violence, gambling, drugs or sexual content in the app itself. Expect IARC 18+ / App Store 17+ because of unrestricted user content and meeting strangers.
- iOS "Made for Kids": No.

## Review notes (both stores)

- Demo account: reviewers can't receive SMS, so production has one review number that signs in with a fixed code and no SMS (`STORE_REVIEW_PHONE` + `STORE_REVIEW_OTP` in the providers secret; attempt caps and rate limits still apply, and the dev code `000000` is refused). ☐ human: pick an unused number and a random 6-digit code, set both in the secret, complete onboarding once so the account has a profile, give both to the reviewers in the review notes, and rotate the code after approval.
- Explain that paid plans are real-world events paid on the web (see Identity).
- Mention that the app is limited to India and starts in Hyderabad, so the reviewer may see few plans outside it.
