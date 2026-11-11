import { BRAND, LIMITS } from '@touchgrass/shared';

/**
 * The legal pages (D-163). The wording describes what the product actually does; a lawyer reviews it before
 * launch (LAUNCH_CHECKLIST §1) and edits it here. Company details come from the environment so one build
 * serves every deployment. English is the binding version.
 */
export interface LegalSection {
  heading: string;
  paragraphs: string[];
}

export interface LegalDocument {
  title: string;
  updated: string;
  intro: string;
  sections: LegalSection[];
}

export interface CompanyDetails {
  entity: string;
  address: string | null;
  supportEmail: string | null;
  grievanceName: string | null;
  grievanceEmail: string | null;
}

/** Read per request: the pages are dynamic. Empty values count as unset. */
export function companyDetails(
  env: Record<string, string | undefined> = process.env,
): CompanyDetails {
  const v = (key: string): string | null => {
    const value = env[key]?.trim();
    return value ? value : null;
  };
  const supportEmail = v('SUPPORT_EMAIL');
  return {
    entity: v('LEGAL_ENTITY_NAME') ?? BRAND.name,
    address: v('LEGAL_ADDRESS'),
    supportEmail,
    grievanceName: v('GRIEVANCE_OFFICER_NAME'),
    grievanceEmail: v('GRIEVANCE_OFFICER_EMAIL') ?? supportEmail,
  };
}

const UPDATED = '9 November 2026';
/** The privacy policy gained the website waitlist (D-169). */
const PRIVACY_UPDATED = '11 November 2026';

export function privacyPolicy(c: CompanyDetails): LegalDocument {
  const grace = LIMITS.account.deletionGraceDays;
  const contact = c.grievanceEmail ?? c.supportEmail ?? 'the contact page';
  return {
    title: 'Privacy policy',
    updated: PRIVACY_UPDATED,
    intro: `${c.entity} ("we") runs ${BRAND.name}, an app for meeting people in person. This policy explains what we collect, why, who processes it for us, how long we keep it and the rights you have under India's Digital Personal Data Protection Act, 2023.`,
    sections: [
      {
        heading: 'What we collect',
        paragraphs: [
          'Your phone number, to sign you in with a one-time code.',
          'Your profile: display name, birthday (to confirm you are 18 or older), pronouns, bio, photos, interests and the neighbourhood you choose.',
          'What you do in the app: plans you create or join, check-ins, messages, comments, stories, photos in Lore, ratings, reports and squad connections.',
          'Location: your approximate area to show nearby plans; your precise location only when you check in at a venue or choose to share live location with trusted contacts.',
          "Contacts, only if you allow it: phone numbers are turned into one-way hashes on your phone before upload and used only to find friends already on the app. We never store your contacts' names or numbers.",
          'A verification selfie, only if you choose to get verified. It is compared with your profile photos and deleted once reviewed (and within a day if you never submit it).',
          'Payments for paid plans: Razorpay handles card, UPI and bank details; we keep the amount, status and receipt.',
          'Device and diagnostics: a push notification token, crash reports and product analytics that carry no names, messages or contact details.',
        ],
      },
      {
        heading: 'Why we use it',
        paragraphs: [
          'To run the service: sign-in, showing and joining plans, chat, payments, refunds and host payouts.',
          'To keep people safe: age checks, verification, moderation of reported or flagged content, blocking, SOS alerts and live location you start.',
          'To improve the app with aggregated, de-identified analytics.',
          'We do not sell your data and do not use it for third-party advertising.',
        ],
      },
      {
        heading: 'Who sees what',
        paragraphs: [
          'Other members see your public profile. Plans, stories and Lore follow the audience you or the host pick. Exact locations of mystery plans are revealed only to confirmed attendees, close to the start.',
          'Processors that act on our behalf under contract: Amazon Web Services (hosting, storage, image checks), MSG91 (SMS), Razorpay (payments), Expo (push notifications), Google Maps (places), OpenWeather (weather), PostHog (analytics) and Sentry (crash reports).',
          'We disclose data to authorities only when Indian law requires it.',
        ],
      },
      {
        heading: 'How long we keep it',
        paragraphs: [
          'Stories disappear after 24 hours and their files are deleted shortly after.',
          'Live location points are deleted within 24 hours.',
          'Verification selfies are deleted after review.',
          `When you delete your account it is hidden at once and permanently erased after ${String(grace)} days, unless you sign in again before then to cancel.`,
          'Payment and tax records are kept for as long as Indian tax law requires. Records of bans and safety actions are kept so a removed person cannot simply return.',
        ],
      },
      {
        heading: 'The website waitlist',
        paragraphs: [
          `If you join the waitlist on our website without an account, we keep the name, mobile number and/or email, city and the optional note you give us, only to send you an invite code when there is room (by email if you gave one, or by our team reaching out to you) and to see which cities to open next. Only our team sees it. We delete it when you ask us at ${contact}, or once it is no longer needed for that purpose.`,
        ],
      },
      {
        heading: 'Your rights',
        paragraphs: [
          'Download a copy of your data: Settings, then Account, then Export my data.',
          'Correct your data: edit your profile at any time.',
          'Delete your account: Settings, then Account, then Delete account, or follow the steps at /delete-account.',
          'Withdraw consent for contacts, location or notifications at any time in your phone settings or the app.',
          `Raise a grievance with our Grievance Officer at ${contact}. If you are not satisfied with our response you may complain to the Data Protection Board of India.`,
        ],
      },
      {
        heading: 'Children',
        paragraphs: [
          `${BRAND.name} is only for people aged 18 and over. We refuse sign-up below that age and remove accounts we learn belong to minors.`,
        ],
      },
      {
        heading: 'Changes',
        paragraphs: [
          'We will tell you in the app before material changes take effect. The date at the top shows the latest version.',
        ],
      },
    ],
  };
}

export function termsOfUse(c: CompanyDetails): LegalDocument {
  return {
    title: 'Terms of use',
    updated: UPDATED,
    intro: `These terms are an agreement between you and ${c.entity} for using ${BRAND.name}. By creating an account you accept them and the privacy policy.`,
    sections: [
      {
        heading: 'Who can use it',
        paragraphs: [
          'You must be 18 or older and able to enter a binding contract under Indian law.',
          'One account per person, with your own phone number and real photos of yourself.',
        ],
      },
      {
        heading: 'Community rules',
        paragraphs: [
          'Be kind and respectful. No harassment, hate, threats, sexual content, spam, scams or selling.',
          'Show up when you say you will. Repeated no-shows lower your reliability and can limit joining plans for a while.',
          'Meet in public places and look after each other. Use blocking, reporting and the safety tools whenever something feels wrong.',
          'We may hold, remove or limit content and warn, mute, suspend or ban accounts that break these rules.',
        ],
      },
      {
        heading: 'Hosts',
        paragraphs: [
          'Hosts are responsible for the plans they create: accurate details, a safe and lawful venue, and being there.',
          'Selling tickets requires an approved host application and completed payout KYC with our payment partner.',
          `For paid plans we charge a platform fee on each ticket, shown before you publish; GST applies to that fee. Host payouts are sent after the plan ends, less refunds.`,
        ],
      },
      {
        heading: 'Paid plans and refunds',
        paragraphs: [
          'Ticket prices include taxes. Payment is confirmed only when our payment partner confirms it.',
          'Refunds follow the policy shown on the plan when you cancel, and are always full when a host cancels. See the refund policy for details.',
        ],
      },
      {
        heading: 'Meeting people',
        paragraphs: [
          `${BRAND.name} helps people find and join in-person plans; we do not run the plans or vet every person or venue. Use your judgement and the safety features. To the extent the law allows, we are not liable for what happens at a plan; nothing here limits liability that cannot be limited under Indian law.`,
        ],
      },
      {
        heading: 'Your content',
        paragraphs: [
          'You own what you post. You give us a licence to store, show and process it to run the service, which ends when you delete it or your account (copies may remain briefly in backups).',
        ],
      },
      {
        heading: 'Ending your account',
        paragraphs: [
          'You can delete your account at any time. We may suspend or end accounts that break these terms or the law, with a way to appeal through the grievance contact.',
        ],
      },
      {
        heading: 'Law and disputes',
        paragraphs: [
          'These terms are governed by the laws of India. Courts in Hyderabad, Telangana have jurisdiction, subject to any consumer rights you have where you live.',
        ],
      },
    ],
  };
}

export function refundPolicy(c: CompanyDetails): LegalDocument {
  return {
    title: 'Refund and cancellation policy',
    updated: UPDATED,
    intro: `How cancellations and refunds work for paid plans on ${BRAND.name}, operated by ${c.entity}.`,
    sections: [
      {
        heading: 'If you cancel',
        paragraphs: [
          'Each paid plan shows its refund policy before you pay. By default you get a full refund if you cancel at least 24 hours before the start.',
          'Hosts may choose a partial refund or no refund, with a cut-off of up to 7 days before the start. The policy shown when you cancel is the one that applies, and the app tells you the exact amount before you confirm.',
        ],
      },
      {
        heading: 'If the host cancels',
        paragraphs: ['You always get a full refund.'],
      },
      {
        heading: 'Other cases',
        paragraphs: [
          'If a payment goes through after your seat hold expired and no seat is free, or you are charged twice, the extra payment is refunded in full automatically.',
          'Free entries from passes or credits are returned as a pass or credit, not money.',
        ],
      },
      {
        heading: 'How long it takes',
        paragraphs: [
          'Refunds go back to the original payment method through Razorpay, usually within 5 to 7 working days depending on your bank.',
          `Questions about a payment: ${c.supportEmail ?? 'see the contact page'}.`,
        ],
      },
    ],
  };
}
