import { Module } from '@nestjs/common';
import { PlusOneClaimService } from './plus-one-claim.service.js';

/** Guest +1 claims; dependency-free so AuthModule can use it during sign-up. */
@Module({ providers: [PlusOneClaimService], exports: [PlusOneClaimService] })
export class PlusOneClaimModule {}
