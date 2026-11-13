import { Injectable } from '@nestjs/common';
import {
  type CustomerAccess,
  type CustomerPlan,
  type CustomerTimelineItem,
  type CustomerView,
} from '@touchgrass/shared';
import { AuditService } from '../../common/audit/audit.service.js';
import { AppError } from '../../common/errors/app-error.js';
import { CitiesService } from '../cities/cities.service.js';
import { CrewsService } from '../crews/crews.service.js';
import { AdminEventsService } from '../events/admin-events.service.js';
import { HostRatingReader } from '../feedback/host-rating-reader.js';
import { InterestsService } from '../interests/interests.service.js';
import { InvitesService } from '../invites/invites.service.js';
import { AdminUsersService } from '../moderation-tools/admin-users.service.js';
import { PaymentsService } from '../payments/payments.service.js';
import { PayoutsService } from '../payments/payouts.service.js';
import { ProfilesService } from '../profiles/profiles.service.js';
import { ReferralsService } from '../referrals/referrals.service.js';
import { ReliabilityReader } from '../reliability/reliability-reader.js';
import { SafetyService } from '../safety/safety.service.js';
import { SocialGraphService } from '../social/graph/social-graph.service.js';
import { ReportsService } from '../social/reports/reports.service.js';
import { UsersService } from '../users/users.service.js';

const PLAN_LIMIT = 100;
const TIMELINE_LIMIT = 150;

/** Whole years between a `YYYY-MM-DD` birth date and `now`, in India's calendar. */
export function ageOn(dateOfBirth: string | null, now: Date): number | null {
  if (!dateOfBirth) return null;
  const [y, m, d] = dateOfBirth.split('-').map(Number);
  if (!y || !m || !d) return null;
  const today = new Date(now.getTime() + 330 * 60_000);
  const before =
    today.getUTCMonth() + 1 < m || (today.getUTCMonth() + 1 === m && today.getUTCDate() < d);
  return today.getUTCFullYear() - y - (before ? 1 : 0);
}

/**
 * Customer 360 (D-192): assembles one person's story from the modules that own each part, never their tables.
 * What is left out on purpose: chat messages, live-location points, blocks and contacts.
 */
@Injectable()
export class CustomersService {
  constructor(
    private readonly users: UsersService,
    private readonly profiles: ProfilesService,
    private readonly interests: InterestsService,
    private readonly cities: CitiesService,
    private readonly adminUsers: AdminUsersService,
    private readonly events: AdminEventsService,
    private readonly ratings: HostRatingReader,
    private readonly reliability: ReliabilityReader,
    private readonly payments: PaymentsService,
    private readonly payouts: PayoutsService,
    private readonly referrals: ReferralsService,
    private readonly graph: SocialGraphService,
    private readonly crews: CrewsService,
    private readonly invites: InvitesService,
    private readonly reports: ReportsService,
    private readonly safety: SafetyService,
    private readonly audit: AuditService,
  ) {}

  async view(
    adminId: string,
    access: CustomerAccess,
    userId: string,
    now: Date = new Date(),
  ): Promise<CustomerView> {
    const user = await this.users.findById(userId);
    if (!user) throw AppError.notFound('User');
    const full = access === 'full';
    const [
      base,
      profile,
      interestIds,
      participation,
      feedback,
      hostRatings,
      tiers,
      cooldown,
      squad,
      crews,
      invitees,
      invitedAt,
    ] = await Promise.all([
      this.adminUsers.detail(adminId, userId, now),
      this.profiles.get(userId),
      this.profiles.interestIdsOf(userId),
      this.events.participation(userId, now),
      this.ratings.feedbackBy(userId),
      this.ratings.summaries([userId]),
      this.reliability.tiers([userId]),
      this.reliability.cooldownUntil(userId, now),
      this.graph.friendIds(userId),
      this.crews.activeCrewsOf(userId),
      this.invites.inviteesOf(userId),
      this.invites.redeemedAt(userId),
    ]);
    const extra = full
      ? await Promise.all([
          this.payments.spendOf(userId),
          this.payouts.earnedBy(userId),
          this.referrals.balance(userId),
          this.reports.countBy(userId),
          this.safety.summaryFor(userId),
        ])
      : null;
    const spend = extra?.[0] ?? null;
    const safety = extra?.[4] ?? null;

    const cityIds = [
      ...new Set([
        ...participation.plans.map((p) => p.cityId),
        ...(profile?.cityId ? [profile.cityId] : []),
      ]),
    ];
    const cityRows = await Promise.all(cityIds.map((id) => this.cities.byId(id)));
    const cityById = new Map(cityRows.flatMap((c) => (c ? [[c.id, c] as const] : [])));
    const names = await this.profiles.displayNames([
      ...(user.invitedByUserId ? [user.invitedByUserId] : []),
      ...invitees.map((i) => i.userId),
    ]);
    const [interests, neighbourhood] = await Promise.all([
      this.interests.interestsByIds(interestIds),
      this.cities.neighbourhoodName(profile?.neighbourhoodId ?? null),
    ]);

    const plans: CustomerPlan[] = participation.plans.slice(0, PLAN_LIMIT).map((p) => {
      const city = cityById.get(p.cityId);
      return {
        eventId: p.eventId,
        title: p.title,
        startsAt: p.startsAt.toISOString(),
        eventStatus: p.eventStatus,
        cityName: city?.name ?? null,
        timezone: city?.timezone ?? 'Asia/Kolkata',
        role: p.role,
        rsvp: p.rsvp,
        pulledUpAt: p.pulledUpAt?.toISOString() ?? null,
        checkedInAt: p.checkedInAt?.toISOString() ?? null,
        lateCancel: p.lateCancel,
        noShow: p.noShow,
        ratingGiven: feedback.get(p.eventId) ?? null,
        paidPaise: spend ? (spend.byEvent.get(p.eventId) ?? null) : null,
      };
    });
    const given = [...feedback.values()];

    const timeline: CustomerTimelineItem[] = [];
    const add = (
      at: Date | null,
      kind: CustomerTimelineItem['kind'],
      extra: Partial<Omit<CustomerTimelineItem, 'at' | 'kind'>> = {},
    ) => {
      if (at)
        timeline.push({
          at: at.toISOString(),
          kind,
          eventId: null,
          label: null,
          personId: null,
          ...extra,
        });
    };
    add(user.createdAt, 'joined');
    if (user.invitedByUserId)
      add(invitedAt ?? user.createdAt, 'invited_by', {
        personId: user.invitedByUserId,
        label: names.get(user.invitedByUserId) ?? null,
      });
    add(profile?.onboardingCompletedAt ?? null, 'onboarded');
    for (const p of participation.plans) {
      const ref = { eventId: p.eventId, label: p.title };
      if (p.role === 'guest') {
        add(p.pulledUpAt, 'pulled_up', ref);
        add(p.checkedInAt, 'checked_in', ref);
        add(p.cancelledAt, 'cancelled', ref);
      } else if (p.eventStatus !== 'draft') add(p.startsAt, 'hosted', ref);
    }
    for (const i of invitees)
      add(new Date(i.redeemedAt), 'invited_someone', {
        personId: i.userId,
        label: names.get(i.userId) ?? null,
      });
    if (full) {
      for (const s of base.sanctions) add(new Date(s.createdAt), 'sanction', { label: s.kind });
      for (const at of safety?.sosAt ?? []) add(at, 'sos');
    }
    timeline.sort((a, b) => b.at.localeCompare(a.at));

    await this.audit.record({
      adminUserId: adminId,
      action: 'users.view_360',
      targetType: 'user',
      targetId: userId,
      details: { access },
    });

    const { person, roles, sanctions, reportsAgainst, mutedUntil, suspendedUntil, ...summary } =
      base;
    return {
      access,
      user: summary,
      phone: full ? user.phoneE164 : null,
      email: full ? user.receiptEmail : null,
      photo: person?.photo ?? null,
      roles,
      lastActiveAt: user.lastActiveAt?.toISOString() ?? null,
      onboardedAt: profile?.onboardingCompletedAt?.toISOString() ?? null,
      profile: {
        bio: profile?.bio ?? '',
        age: ageOn(profile?.dateOfBirth ?? null, now),
        gender: profile?.gender ?? null,
        pronouns: profile?.pronouns ?? null,
        city: cityById.get(profile?.cityId ?? '')?.name ?? null,
        neighbourhood,
        spokenLanguages: profile?.spokenLanguages ?? [],
        appLanguage: user.language,
        interests: interests.map((i) => i.name.en),
      },
      invitedBy: user.invitedByUserId
        ? { id: user.invitedByUserId, name: names.get(user.invitedByUserId) ?? null }
        : null,
      invitedAt: user.invitedByUserId ? (invitedAt ?? user.createdAt).toISOString() : null,
      invitees: invitees
        .map((i) => ({ id: i.userId, name: names.get(i.userId) ?? null, at: i.redeemedAt }))
        .sort((a, b) => a.at.localeCompare(b.at)),
      stats: participation.stats,
      reliability: {
        tier: tiers.get(userId) ?? 'new',
        cooldownUntil: cooldown?.toISOString() ?? null,
      },
      hostRating: hostRatings.get(userId) ?? { average: null, count: 0 },
      ratingsGiven: {
        count: given.length,
        average:
          given.length === 0
            ? null
            : Math.round((given.reduce((n, r) => n + r, 0) / given.length) * 10) / 10,
      },
      plans,
      social: { squad: squad.length, crews },
      spend: extra
        ? {
            paidPaise: extra[0].paidPaise,
            refundedPaise: extra[0].refundedPaise,
            payments: extra[0].payments,
            lastPaidAt: extra[0].lastPaidAt?.toISOString() ?? null,
            hostEarnedPaise: extra[1],
            priorityPasses: extra[2].priorityPasses,
            credits: extra[2].credits,
          }
        : null,
      safety: extra
        ? {
            reportsAgainst,
            reportsMade: extra[3],
            sanctions,
            mutedUntil,
            suspendedUntil,
            sosCount: extra[4].sosCount,
            lastSosAt: extra[4].lastSosAt?.toISOString() ?? null,
            trustedContacts: extra[4].trustedContacts,
          }
        : null,
      timeline: timeline.slice(0, TIMELINE_LIMIT),
    };
  }
}
