/** Brand and product-wide constants. Values that admins can tune live in feature flags / config tables instead. */
export const BRAND = {
  name: 'TouchGrass',
  tagline: 'Log off. Pull up.',
  storeSubtitle: 'Plans, people, IRL',
  shortLinkHost: 'tg.app',
} as const;

export const LOCALE_DEFAULTS = {
  timezone: 'Asia/Kolkata',
  currency: 'INR',
  countryCode: 'IN',
  dialCode: '+91',
  launchCitySlug: 'hyderabad',
} as const;

export const SUPPORTED_LANGUAGES = ['en', 'te', 'hi'] as const;
export type SupportedLanguage = (typeof SUPPORTED_LANGUAGES)[number];

export const MINUTE_MS = 60_000;
export const HOUR_MS = 60 * MINUTE_MS;
export const DAY_MS = 24 * HOUR_MS;

export const LIMITS = {
  otp: {
    length: 6,
    ttlMs: 5 * MINUTE_MS,
    maxAttempts: 5,
    devBypassCode: '000000',
    resendAfterMs: 30_000,
  },
  tokens: { accessTtlSeconds: 15 * 60, refreshTtlSeconds: 60 * 24 * 60 * 60 },
  minAgeYears: 18,
  profile: {
    maxPhotos: 6,
    minPhotos: 1,
    minInterests: 3,
    maxInterests: 15,
    bioMaxLength: 300,
    maxVibeTags: 5,
    displayNameMin: 2,
    displayNameMax: 40,
    pronounsMax: 30,
    maxSpokenLanguages: 8,
  },
  invites: { defaultPerUser: 5, codeLength: 8, defaultExpiryDays: 30 },
  sessions: { maxActivePerUser: 10 },
  social: { maxContactHashes: 5000, reportDetailsMax: 1000, suggestionLimit: 20, mutualSample: 3 },
  upload: {
    maxImageBytes: 10 * 1024 * 1024,
    allowedImageTypes: ['image/jpeg', 'image/png', 'image/webp'],
    /** Video is for stories only (D-164): re-encoded on our servers, so phone formats are accepted. */
    maxVideoBytes: 30 * 1024 * 1024,
    allowedVideoTypes: ['video/mp4', 'video/quicktime'],
    maxVideoSeconds: 15,
  },
  imageSizes: [160, 480, 1080] as const,
  event: {
    smallGroupMin: 4,
    smallGroupMax: 8,
    titleMinLength: 3,
    titleMaxLength: 80,
    descriptionMaxLength: 2000,
    minCapacity: 2,
    maxCapacity: 1000,
    maxDurationHours: 72,
    maxDaysAhead: 180,
    slugLength: 8,
    maxInviteBatch: 100,
    balancedMinSharePct: 34,
    balancedMaxSharePct: 80,
  },
  mystery: {
    minFuzzMeters: 1000,
    maxFuzzMeters: 1500,
    areaRadiusMeters: 2000,
    defaultRevealBeforeMs: 2 * HOUR_MS,
  },
  checkIn: { geofenceMeters: 150, windowBeforeMs: 30 * MINUTE_MS, windowAfterMs: 2 * HOUR_MS },
  waitlist: { claimWindowMs: 30 * MINUTE_MS, lastMinuteThresholdMs: 6 * HOUR_MS },
  payments: {
    /** A spot is held this long while someone pays (F-PAY-01). */
    holdMs: 10 * MINUTE_MS,
    /** GST on the platform fee, in basis points (18%). */
    gstBps: 1800,
    defaultPlatformFeeBps: 1000,
    defaultPayoutDelayHours: 24,
    maxRefundCutoffHours: 168,
    /** Perk passes work from the start of the plan's day until it ends plus this long. */
    perkGraceMs: 6 * HOUR_MS,
  },
  discovery: {
    /** Candidates ranked per feed request (before pagination). */
    candidatePool: 400,
    /** How far ahead the feed looks by default. */
    horizonDays: 30,
    /** A ranked feed snapshot is reused for paging this long. */
    snapshotTtlMs: 5 * MINUTE_MS,
    previewSize: 3,
    mapMaxPins: 300,
    searchMinLength: 2,
  },
  chat: {
    eventChatOpensBeforeMs: 24 * HOUR_MS,
    eventChatClosesAfterMs: 48 * HOUR_MS,
    deleteForEveryoneWindowMs: HOUR_MS,
    dmSharedEventWindowMs: 30 * DAY_MS,
    maxMessageLength: 4000,
    /** A DM request is one message until the other person accepts. */
    requestMaxMessages: 1,
    /** Client ids kept for offline-queue de-duplication. */
    clientIdRetentionMs: 7 * DAY_MS,
    typingTtlMs: 6000,
    pageMax: 100,
  },
  signal: { showBeforeMs: 30 * MINUTE_MS },
  reliability: {
    lateCancelWindowMs: 3 * HOUR_MS,
    /** Older commitments count half as much every this many days. */
    halfLifeDays: 90,
    /** Fewer commitments than this in a year: still "new" (no tier). */
    minCommitments: 3,
    /** A late cancel costs half a no-show. */
    lateCancelWeight: 0.5,
    /** This many no-shows within the window start a cooldown on popular plans. */
    cooldownNoShows: 2,
    cooldownWindowDays: 60,
    cooldownDays: 14,
    /** Popular = at most this share of spots left (or a waitlist). */
    popularSpotsShare: 0.2,
  },
  after: {
    /** The post-event screen offers plans that ended within this many days. */
    postEventWindowDays: 7,
    /** Feedback and host ratings are accepted until this many days after the end. */
    feedbackWindowDays: 14,
    commentMaxLength: 1000,
    captionMaxLength: 200,
    /** Host ratings show on profiles from this many ratings. */
    minRatingsToShow: 3,
    lorePerPersonPerEvent: 30,
    loreDownloadTtlSeconds: 24 * 3600,
  },
  stories: {
    /** A story is visible for this long after posting. */
    lifetimeHours: 24,
    /** Most live stories one person can have at a time. */
    maxLivePerAuthor: 20,
    captionMaxLength: 200,
    /** Expired stories stay hidden this long (for reports in flight), then the rows and files are deleted. */
    purgeGraceHours: 72,
    /** Most people the story tray lists. */
    trayMaxAuthors: 100,
  },
  comments: {
    /** Longest comment on a plan. */
    maxLength: 500,
  },
  availability: { minHours: 1, maxHours: 6, noteMaxLength: 120 },
  crews: {
    nameMinLength: 3,
    nameMaxLength: 60,
    descriptionMaxLength: 500,
    maxMembers: 200,
    /** Sessions are generated this many days ahead of time. */
    sessionLeadDays: 14,
    sessionMinMinutes: 30,
    sessionMaxMinutes: 12 * 60,
    maxInviteBatch: 30,
  },
  proposals: {
    titleMinLength: 3,
    titleMaxLength: 80,
    optionLabelMaxLength: 120,
    maxOptions: 24,
    maxInvitees: 30,
    minDeadlineMinutes: 30,
    maxDeadlineDays: 14,
    durationMinMinutes: 30,
    durationMaxMinutes: 12 * 60,
  },
  gamification: {
    /** One streak freeze per calendar month (IST). */
    freezesPerMonth: 1,
    badgeNameMaxLength: 40,
    badgeDescriptionMaxLength: 160,
    challengeTitleMaxLength: 80,
    challengeDescriptionMaxLength: 400,
    maxRuleThreshold: 1000,
  },
  referrals: {
    codeLength: 6,
    codePrefix: 'TG',
    defaultPriorityPasses: 2,
    defaultCredits: 1,
    defaultCreditMaxRupees: 500,
    defaultMaxRewarded: 20,
  },
  safety: {
    maxTrustedContacts: 3,
    liveLocationRetentionMs: 24 * HOUR_MS,
    emergencyNumber: '112',
    /** Shown in the safety centre (F-SAF-07), most urgent first. */
    helplines: [
      { key: 'emergency', number: '112' },
      { key: 'police', number: '100' },
      { key: 'women', number: '181' },
      { key: 'ambulance', number: '108' },
      { key: 'cyber', number: '1930' },
    ],
    shareDurations: [30, 60, 120, 240],
    contactNameMaxLength: 60,
    shareMinMinutes: 15,
    shareMaxMinutes: 4 * 60,
    /** Sharing tied to a plan is allowed from this long before it starts until this long after it ends. */
    eventWindowBeforeMs: 2 * HOUR_MS,
    eventWindowAfterMs: 3 * HOUR_MS,
    /** The public viewer shows this many recent points as a trail. */
    trailPoints: 20,
    maxAccuracyMeters: 5000,
  },
  verification: {
    /** A pose challenge must be answered with a selfie within this time. */
    challengeTtlMs: 15 * MINUTE_MS,
    /** Attempts per person per day (rejections included). */
    maxAttemptsPerDay: 3,
  },
  moderation: {
    reasonMaxLength: 500,
    maxSanctionDays: 365,
  },
  notifications: {
    quietHoursStart: 22,
    quietHoursEnd: 8,
    squadGoingMaxPerHour: 1,
    /** "N of your squad are pulling up" needs at least this many of your squad going (Phase 13). */
    squadPullingUpMin: 3,
    /** "Your squad is outside" needs at least this many of your squad checked in recently. */
    squadOutsideMin: 2,
    squadOutsideWindowMs: 3 * HOUR_MS,
    /** Low-priority notifications wait this long so several can go out as one digest. */
    batchWindowMs: 10 * MINUTE_MS,
    inboxPageMax: 50,
    /** Inbox items older than this are deleted. */
    inboxRetentionMs: 90 * DAY_MS,
    reminderLongMs: 24 * HOUR_MS,
    reminderShortMs: 2 * HOUR_MS,
  },
  calendar: { pastDays: 30, futureDays: 180 },
  analytics: { maxClientEvents: 20 },
  // DPDP: deactivated immediately, purged after the grace period; the daily purge job keeps total time well under 30 days.
  account: { deletionGraceDays: 14, deletionDeadlineDays: 30 },
  pagination: { defaultLimit: 20, maxLimit: 100 },
} as const;
