import { ReferralCodesModule } from '../referrals/referral-codes.module.js';
import { ProfilesModule } from '../profiles/profiles.module.js';
import { UsersModule } from '../users/users.module.js';
import { Module } from '@nestjs/common';
import { InvitesModule } from '../invites/invites.module.js';
import { WaitlistAdminController, WaitlistController } from './waitlist.controller.js';
import { WaitlistService } from './waitlist.service.js';

/**
 * Public launch waitlist (D-169). Not tied to accounts, so no AccountDataContributor: entries are removed by
 * an admin on request. Codes are created through InvitesService, never by writing invite_codes here.
 */
@Module({
  imports: [InvitesModule, ReferralCodesModule, ProfilesModule, UsersModule],
  controllers: [WaitlistController, WaitlistAdminController],
  providers: [WaitlistService],
})
export class WaitlistModule {}
