import { Module } from '@nestjs/common';
import { ReferralCodesService } from './referral-codes.service.js';

/** Referral codes for sign-up (imported by auth). */
@Module({ providers: [ReferralCodesService], exports: [ReferralCodesService] })
export class ReferralCodesModule {}
