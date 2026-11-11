import type * as Dto from '@touchgrass/shared';
import { normalizeE164 } from '@touchgrass/shared';
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import {
  AuthResponse,
  AuthTokens,
  InviteCheckBody,
  InviteCheckResponse,
  OtpRequestBody,
  OtpRequestResponse,
  OtpVerifyBody,
  PhoneProofSignInBody,
  RefreshBody,
  SessionList,
} from '@touchgrass/shared';
import type { z } from 'zod';
import { AllowOnboarding, CurrentUser, Public } from '../../common/auth/decorators.js';
import {
  type AppRequest,
  type AuthPrincipal,
  clientIp,
} from '../../common/http/request-context.js';
import { ApiZodBody, ApiZodResponse } from '../../common/openapi/zod-openapi.js';
import { RateLimit } from '../../common/rate-limit/rate-limit.decorator.js';
import { ZodPipe } from '../../common/validation/zod.js';
import { InvitesService } from '../invites/invites.service.js';
import { AuthService } from './auth.service.js';
import { SessionsService } from './sessions.service.js';

@ApiTags('auth')
@Controller({ path: 'auth', version: '1' })
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly invites: InvitesService,
  ) {}

  @Public()
  @Post('otp/request')
  @HttpCode(200)
  @RateLimit(
    {
      name: 'otp-request-phone',
      limit: 5,
      windowSeconds: 3600,
      by: 'body',
      bodyField: 'phone',
      normalize: normalizeE164,
    },
    { name: 'otp-request-ip', limit: 20, windowSeconds: 3600, by: 'ip' },
  )
  @ApiZodBody(OtpRequestBody)
  @ApiZodResponse(200, OtpRequestResponse)
  request(
    @Body(new ZodPipe(OtpRequestBody)) body: Dto.OtpRequestBody,
    @Req() req: AppRequest,
  ): Promise<OtpRequestResponse> {
    return this.auth.requestOtp(body.phone, clientIp(req));
  }

  @Public()
  @Post('otp/verify')
  @HttpCode(200)
  @RateLimit(
    {
      name: 'otp-verify-phone',
      limit: 10,
      windowSeconds: 900,
      by: 'body',
      bodyField: 'phone',
      normalize: normalizeE164,
    },
    { name: 'otp-verify-ip', limit: 30, windowSeconds: 900, by: 'ip' },
  )
  @ApiZodBody(OtpVerifyBody)
  @ApiZodResponse(200, AuthResponse)
  verify(
    @Body(new ZodPipe(OtpVerifyBody)) body: Dto.OtpVerifyBody,
    @Req() req: AppRequest,
  ): Promise<AuthResponse> {
    return this.auth.verifyOtp(body, clientIp(req));
  }

  /** Sign-in with a Firebase phone proof (D-166): the provider texted and checked the code. */
  @Public()
  @Post('phone-proof')
  @HttpCode(200)
  @RateLimit({ name: 'phone-proof-ip', limit: 30, windowSeconds: 900, by: 'ip' })
  @ApiZodBody(PhoneProofSignInBody)
  @ApiZodResponse(200, AuthResponse)
  phoneProof(
    @Body(new ZodPipe(PhoneProofSignInBody)) body: Dto.PhoneProofSignInBody,
    @Req() req: AppRequest,
  ): Promise<AuthResponse> {
    return this.auth.signInWithPhoneProof(body, clientIp(req));
  }

  @Public()
  @Post('invites/check')
  @HttpCode(200)
  @RateLimit({ name: 'invite-check-ip', limit: 20, windowSeconds: 3600, by: 'ip' })
  @ApiZodBody(InviteCheckBody)
  @ApiZodResponse(200, InviteCheckResponse)
  checkInvite(
    @Body(new ZodPipe(InviteCheckBody)) body: Dto.InviteCheckBody,
  ): Promise<InviteCheckResponse> {
    return this.invites.check(body.code);
  }

  @Public()
  @Post('refresh')
  @HttpCode(200)
  @RateLimit({ name: 'refresh-ip', limit: 60, windowSeconds: 60, by: 'ip' })
  @ApiZodBody(RefreshBody)
  @ApiZodResponse(200, AuthTokens)
  refresh(@Body(new ZodPipe(RefreshBody)) body: Dto.RefreshBody): Promise<AuthTokens> {
    return this.auth.refresh(body.refreshToken);
  }

  @Post('logout')
  @HttpCode(204)
  @AllowOnboarding()
  @ApiBearerAuth()
  async logout(@CurrentUser() user: AuthPrincipal): Promise<void> {
    await this.auth.logout(user.userId, user.sessionId);
  }
}

@ApiTags('sessions')
@ApiBearerAuth()
@AllowOnboarding()
@Controller({ path: 'me/sessions', version: '1' })
export class SessionsController {
  constructor(private readonly sessions: SessionsService) {}

  @Get()
  @ApiZodResponse(200, SessionList)
  async list(@CurrentUser() user: AuthPrincipal): Promise<z.infer<typeof SessionList>> {
    return { items: await this.sessions.list(user.userId, user.sessionId) };
  }

  @Delete(':id')
  @HttpCode(204)
  async revoke(
    @CurrentUser() user: AuthPrincipal,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<void> {
    await this.sessions.revoke(user.userId, id, 'user_revoked');
  }
}
