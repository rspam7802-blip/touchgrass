import { Module } from '@nestjs/common';
import { PlusOneClaimModule } from '../events/plus-one/plus-one-claim.module.js';
import { ReferralCodesModule } from '../referrals/referral-codes.module.js';
import { InvitesModule } from '../invites/invites.module.js';
import { PlatformModule } from '../platform/platform.module.js';
import { ProfilesModule } from '../profiles/profiles.module.js';
import { UsersModule } from '../users/users.module.js';
import { AuthController, SessionsController } from './auth.controller.js';
import { AuthService } from './auth.service.js';
import { OtpService } from './otp.service.js';
import { SessionsService } from './sessions.service.js';

@Module({
  imports: [
    UsersModule,
    ProfilesModule,
    InvitesModule,
    PlatformModule,
    PlusOneClaimModule,
    ReferralCodesModule,
  ],
  controllers: [AuthController, SessionsController],
  providers: [AuthService, OtpService, SessionsService],
  exports: [SessionsService, OtpService],
})
export class AuthModule {}
