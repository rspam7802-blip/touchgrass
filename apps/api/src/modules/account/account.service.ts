import { Inject, Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { LIMITS, maskPhone } from '@touchgrass/shared';
import { and, eq, lte } from 'drizzle-orm';
import { AppError } from '../../common/errors/app-error.js';
import { DB, type Database } from '../../infra/database/database.module.js';
import { users } from '../../infra/database/schema/index.js';
import { OutboxService } from '../../infra/outbox/outbox.service.js';
import { SessionsService } from '../auth/sessions.service.js';
import { InvitesService } from '../invites/invites.service.js';
import { MediaService } from '../media/media.service.js';
import { ProfilesService } from '../profiles/profiles.service.js';
import { UsersService } from '../users/users.service.js';
import { AccountDataRegistry } from './account-data.registry.js';
import { SettingsService } from './settings.service.js';
import { CityWaitlistService } from '../cities/city-waitlist.service.js';

const DAY = 86_400_000;
export const ACCOUNT_DELETION_REQUESTED_EVENT = 'user.deletion_requested';
export const ACCOUNT_PURGED_EVENT = 'user.purged';
export const USER_ONBOARDED_EVENT = 'user.onboarded';

/** Export, deletion (DPDP Act 2023) and the age gate. */
@Injectable()
export class AccountService implements OnModuleInit {
  private readonly logger = new Logger(AccountService.name);

  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly users: UsersService,
    private readonly profiles: ProfilesService,
    private readonly sessions: SessionsService,
    private readonly settings: SettingsService,
    private readonly invites: InvitesService,
    private readonly media: MediaService,
    private readonly registry: AccountDataRegistry,
    private readonly outbox: OutboxService,
    private readonly cityWaitlist: CityWaitlistService,
  ) {}

  onModuleInit(): void {
    // The cities module is a leaf (profiles import it), so its waitlist data is registered here.
    this.registry.register({
      name: 'city-waitlist',
      export: (userId) => this.cityWaitlist.exportFor(userId),
      erase: async (userId, tx) => {
        await this.cityWaitlist.leave(userId, tx);
        return undefined;
      },
    });
    this.registry.register({
      name: 'account',
      export: async (userId) => {
        const user = await this.users.findById(userId);
        return user
          ? {
              id: user.id,
              phone: user.phoneE164 ? maskPhone(user.phoneE164) : null,
              status: user.status,
              language: user.language,
              createdAt: user.createdAt.toISOString(),
            }
          : null;
      },
      erase: () => Promise.resolve(undefined),
    });
    this.registry.register({
      name: 'profile',
      export: async (userId) => ({
        profile: await this.profiles.get(userId),
        interestIds: await this.profiles.interestIdsOf(userId),
        vibeTagIds: await this.profiles.vibeTagIdsOf(userId),
        photos: await this.profiles.photos(userId, true),
      }),
      erase: async (userId, tx) => {
        await this.profiles.erase(userId, tx);
        const owned = await this.media.ownedAssetIds(userId);
        return () => this.media.destroy(owned);
      },
    });
    this.registry.register({
      name: 'settings',
      export: async (userId) => ({
        notificationPreferences: await this.settings.notificationPreferences(userId),
        privacy: await this.profiles.privacy(userId).catch(() => null),
        devices: await this.settings.devices(userId),
      }),
      erase: async (userId, tx) => {
        await this.settings.eraseFor(userId, tx);
        return undefined;
      },
    });
    this.registry.register({
      name: 'consents',
      export: (userId) => this.settings.consents(userId),
      // Consent records are retained after deletion as evidence of lawful processing.
      erase: () => Promise.resolve(undefined),
    });
    this.registry.register({
      name: 'sessions',
      export: (userId) => this.sessions.list(userId, ''),
      erase: async (userId, tx) => {
        await this.sessions.revokeAll(userId, 'deleted', tx);
        return undefined;
      },
    });
    this.registry.register({
      name: 'invites',
      export: async (userId) => ({
        created: (await this.invites.mine(userId)).items,
        invitees: (await this.invites.inviteesOf(userId)).length,
      }),
      erase: async (userId, tx) => {
        await this.invites.revokeAllBy(userId, tx);
        return undefined;
      },
    });
  }

  async export(userId: string): Promise<Record<string, unknown>> {
    const out: Record<string, unknown> = {
      exportedAt: new Date().toISOString(),
      format: 'touchgrass-export-v1',
    };
    for (const c of this.registry.all()) out[c.name] = await c.export(userId);
    return out;
  }

  /** Deactivates now (sessions revoked, devices off), purges after the grace period. Signing in again cancels. */
  async requestDeletion(userId: string, now: Date = new Date()): Promise<{ purgeAfter: string }> {
    const user = await this.users.findById(userId);
    if (!user || user.status === 'deleted') throw AppError.notFound('Account');
    await this.db.transaction(async (tx) => {
      await this.users.setStatus(userId, 'deletion_pending', tx, { deletionRequestedAt: now });
      await this.settings.disableDevices(userId, tx);
      await this.outbox.add(tx, {
        aggregateType: 'user',
        aggregateId: userId,
        type: ACCOUNT_DELETION_REQUESTED_EVENT,
        payload: {},
      });
    });
    await this.sessions.revokeAll(userId, 'deletion_requested');
    return {
      purgeAfter: new Date(now.getTime() + LIMITS.account.deletionGraceDays * DAY).toISOString(),
    };
  }

  /** Irreversibly erases personal data. The users row stays as an anonymous tombstone for consent records and FKs. */
  async purge(userId: string): Promise<void> {
    const cleanups: (() => Promise<void>)[] = [];
    await this.db.transaction(async (tx) => {
      for (const c of this.registry.all()) {
        const cleanup = await c.erase(userId, tx);
        if (cleanup) cleanups.push(cleanup);
      }
      await this.users.setStatus(userId, 'deleted', tx, {
        phoneE164: null,
        phoneHash: null,
        cityId: null,
        deletedAt: new Date(),
      });
      await this.outbox.add(tx, {
        aggregateType: 'user',
        aggregateId: userId,
        type: ACCOUNT_PURGED_EVENT,
        payload: {},
      });
    });
    for (const cleanup of cleanups) await cleanup();
  }

  /** Daily worker job: purge accounts whose grace period ended. */
  async purgeDue(now: Date = new Date()): Promise<number> {
    const cutoff = new Date(now.getTime() - LIMITS.account.deletionGraceDays * DAY);
    const due = await this.db
      .select({ id: users.id })
      .from(users)
      .where(and(eq(users.status, 'deletion_pending'), lte(users.deletionRequestedAt, cutoff)));
    for (const { id } of due) {
      await this.purge(id);
      this.logger.log(`purged account ${id}`);
    }
    return due.length;
  }

  /**
   * Under-18 date of birth (F-ACC-03): the account is blocked, all profile data and the raw phone number are
   * erased; only the phone hash is kept so the same number cannot sign up again.
   */
  async ageBlock(userId: string): Promise<void> {
    let photoIds: string[] = [];
    await this.db.transaction(async (tx) => {
      photoIds = await this.profiles.erase(userId, tx);
      await this.settings.eraseFor(userId, tx);
      await this.users.setStatus(userId, 'age_blocked', tx, { phoneE164: null });
    });
    await this.sessions.revokeAll(userId, 'age_blocked');
    await this.media.destroy([...photoIds, ...(await this.media.ownedAssetIds(userId))]);
  }

  /** Onboarding gate: profile complete → account becomes active. */
  async completeOnboarding(userId: string): Promise<void> {
    const state = await this.profiles.onboardingState(userId);
    if (!state.complete)
      throw new AppError('ONBOARDING_INCOMPLETE', 'Onboarding is not complete', state);
    await this.db.transaction(async (tx) => {
      await this.profiles.markOnboardingComplete(userId, tx);
      const user = await this.users.findById(userId, tx);
      if (user?.status === 'onboarding') {
        await this.users.setStatus(userId, 'active', tx);
        await this.outbox.add(tx, {
          aggregateType: 'user',
          aggregateId: userId,
          type: USER_ONBOARDED_EVENT,
          payload: {},
        });
      }
    });
  }
}
