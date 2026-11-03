import type * as Dto from '@touchgrass/shared';
import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Put } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import {
  DeleteAccountBody,
  DeletionScheduledResponse,
  InterestList,
  InviteCode,
  MeResponse,
  MyInvites,
  NotificationPreferences,
  PrivacySettings,
  RecordConsentBody,
  RegisterDeviceBody,
  SetInterestsBody,
  SetPhotosBody,
  SetVibeTagsBody,
  UpdateLanguageBody,
  UpdateNotificationPreferencesBody,
  UpdatePrivacyBody,
  UpdateProfileBody,
  VibeTagList,
} from '@touchgrass/shared';
import { z } from 'zod';
import { AllowOnboarding, CurrentUser } from '../../common/auth/decorators.js';
import { AppError } from '../../common/errors/app-error.js';
import type { AuthPrincipal } from '../../common/http/request-context.js';
import { Idempotent } from '../../common/idempotency/idempotency.js';
import { ApiZodBody, ApiZodResponse } from '../../common/openapi/zod-openapi.js';
import { RateLimit } from '../../common/rate-limit/rate-limit.decorator.js';
import { ZodPipe } from '../../common/validation/zod.js';
import { InvitesService } from '../invites/invites.service.js';
import { ProfilesService } from '../profiles/profiles.service.js';
import { UsersService } from '../users/users.service.js';
import { AccountService } from './account.service.js';
import { MeService } from './me.service.js';
import { SettingsService } from './settings.service.js';

@ApiTags('me')
@ApiBearerAuth()
@AllowOnboarding()
@Controller({ path: 'me', version: '1' })
export class MeController {
  constructor(
    private readonly me: MeService,
    private readonly profiles: ProfilesService,
    private readonly account: AccountService,
    private readonly settings: SettingsService,
    private readonly users: UsersService,
    private readonly invites: InvitesService,
  ) {}

  @Get()
  @ApiZodResponse(200, MeResponse)
  get(@CurrentUser() user: AuthPrincipal): Promise<MeResponse> {
    return this.me.me(user.userId);
  }

  @Patch('profile')
  @ApiZodBody(UpdateProfileBody)
  @ApiZodResponse(200, MeResponse)
  async updateProfile(
    @CurrentUser() user: AuthPrincipal,
    @Body(new ZodPipe(UpdateProfileBody)) body: Dto.UpdateProfileBody,
  ): Promise<MeResponse> {
    const result = await this.profiles.update(user.userId, body);
    if (result.kind === 'underage') {
      await this.account.ageBlock(user.userId);
      throw new AppError('AGE_RESTRICTED', 'TouchGrass is for people 18 and over');
    }
    return this.me.me(user.userId);
  }

  @Put('interests')
  @ApiZodBody(SetInterestsBody)
  @ApiZodResponse(200, InterestList)
  async setInterests(
    @CurrentUser() user: AuthPrincipal,
    @Body(new ZodPipe(SetInterestsBody)) body: Dto.SetInterestsBody,
  ): Promise<z.infer<typeof InterestList>> {
    return { items: await this.profiles.setInterests(user.userId, body.interestIds) };
  }

  @Put('vibe-tags')
  @ApiZodBody(SetVibeTagsBody)
  @ApiZodResponse(200, VibeTagList)
  async setVibes(
    @CurrentUser() user: AuthPrincipal,
    @Body(new ZodPipe(SetVibeTagsBody)) body: Dto.SetVibeTagsBody,
  ): Promise<z.infer<typeof VibeTagList>> {
    return { items: await this.profiles.setVibeTags(user.userId, body.vibeTagIds) };
  }

  @Put('photos')
  @ApiZodBody(SetPhotosBody)
  @ApiZodResponse(200, MeResponse)
  async setPhotos(
    @CurrentUser() user: AuthPrincipal,
    @Body(new ZodPipe(SetPhotosBody)) body: Dto.SetPhotosBody,
  ): Promise<MeResponse> {
    await this.profiles.setPhotos(user.userId, body.mediaAssetIds);
    return this.me.me(user.userId);
  }

  @Post('onboarding/complete')
  @HttpCode(200)
  @ApiZodResponse(200, MeResponse)
  async completeOnboarding(@CurrentUser() user: AuthPrincipal): Promise<MeResponse> {
    await this.account.completeOnboarding(user.userId);
    return this.me.me(user.userId);
  }

  @Post('tutorial/complete')
  @HttpCode(204)
  async completeTutorial(@CurrentUser() user: AuthPrincipal): Promise<void> {
    await this.profiles.setTutorialComplete(user.userId, true);
  }

  /** Replay from settings. */
  @Delete('tutorial')
  @HttpCode(204)
  async resetTutorial(@CurrentUser() user: AuthPrincipal): Promise<void> {
    await this.profiles.setTutorialComplete(user.userId, false);
  }

  @Get('settings/privacy')
  @ApiZodResponse(200, PrivacySettings)
  privacy(@CurrentUser() user: AuthPrincipal): Promise<PrivacySettings> {
    return this.profiles.privacy(user.userId);
  }

  @Put('settings/privacy')
  @ApiZodBody(UpdatePrivacyBody)
  @ApiZodResponse(200, PrivacySettings)
  updatePrivacy(
    @CurrentUser() user: AuthPrincipal,
    @Body(new ZodPipe(UpdatePrivacyBody)) body: Dto.UpdatePrivacyBody,
  ): Promise<PrivacySettings> {
    return this.profiles.updatePrivacy(user.userId, body);
  }

  @Get('settings/notifications')
  @ApiZodResponse(200, NotificationPreferences)
  async notifications(
    @CurrentUser() user: AuthPrincipal,
  ): Promise<z.infer<typeof NotificationPreferences>> {
    return { items: await this.settings.notificationPreferences(user.userId) };
  }

  @Put('settings/notifications')
  @ApiZodBody(UpdateNotificationPreferencesBody)
  @ApiZodResponse(200, NotificationPreferences)
  async updateNotifications(
    @CurrentUser() user: AuthPrincipal,
    @Body(new ZodPipe(UpdateNotificationPreferencesBody))
    body: Dto.UpdateNotificationPreferencesBody,
  ): Promise<z.infer<typeof NotificationPreferences>> {
    return { items: await this.settings.updateNotificationPreferences(user.userId, body.items) };
  }

  @Put('settings/language')
  @HttpCode(204)
  @ApiZodBody(UpdateLanguageBody)
  async language(
    @CurrentUser() user: AuthPrincipal,
    @Body(new ZodPipe(UpdateLanguageBody)) body: Dto.UpdateLanguageBody,
  ): Promise<void> {
    await this.users.setLanguage(user.userId, body.language);
  }

  @Post('consents')
  @HttpCode(204)
  @ApiZodBody(RecordConsentBody)
  async consent(
    @CurrentUser() user: AuthPrincipal,
    @Body(new ZodPipe(RecordConsentBody)) body: Dto.RecordConsentBody,
  ): Promise<void> {
    await this.settings.recordConsent(user.userId, body);
  }

  @Post('devices')
  @HttpCode(204)
  @ApiZodBody(RegisterDeviceBody)
  async registerDevice(
    @CurrentUser() user: AuthPrincipal,
    @Body(new ZodPipe(RegisterDeviceBody)) body: Dto.RegisterDeviceBody,
  ): Promise<void> {
    await this.settings.registerDevice(user.userId, user.sessionId, body);
  }

  @Delete('devices/:token')
  @HttpCode(204)
  async unregisterDevice(
    @CurrentUser() user: AuthPrincipal,
    @Param('token') token: string,
  ): Promise<void> {
    await this.settings.unregisterDevice(user.userId, token);
  }

  @Get('export')
  @RateLimit({ name: 'data-export', limit: 3, windowSeconds: 86_400, by: 'user' })
  export(@CurrentUser() user: AuthPrincipal): Promise<Record<string, unknown>> {
    return this.account.export(user.userId);
  }

  @Post('deletion')
  @HttpCode(202)
  @ApiZodBody(DeleteAccountBody)
  @ApiZodResponse(202, DeletionScheduledResponse)
  requestDeletion(
    @CurrentUser() user: AuthPrincipal,
    @Body(new ZodPipe(DeleteAccountBody)) _body: Dto.DeleteAccountBody,
  ): Promise<{ purgeAfter: string }> {
    return this.account.requestDeletion(user.userId);
  }

  @Get('invites')
  @ApiZodResponse(200, MyInvites)
  myInvites(@CurrentUser() user: AuthPrincipal): Promise<MyInvites> {
    return this.invites.mine(user.userId);
  }

  @Post('invites')
  @Idempotent()
  @RateLimit({ name: 'invite-create', limit: 10, windowSeconds: 86_400, by: 'user' })
  @ApiZodResponse(201, InviteCode)
  createInvite(@CurrentUser() user: AuthPrincipal): Promise<InviteCode> {
    return this.invites.createForUser(user.userId);
  }
}
