import { Controller, Get, Param, ParseUUIDPipe } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { PublicProfile, PublicProfileView } from '@touchgrass/shared';
import { CurrentUser, Public } from '../../common/auth/decorators.js';
import { AppError } from '../../common/errors/app-error.js';
import { RateLimit } from '../../common/rate-limit/rate-limit.decorator.js';
import type { AuthPrincipal } from '../../common/http/request-context.js';
import { ApiZodResponse } from '../../common/openapi/zod-openapi.js';
import { ProfilesService } from './profiles.service.js';

@ApiTags('profiles')
@ApiBearerAuth()
@Controller({ path: 'users', version: '1' })
export class ProfilesController {
  constructor(private readonly profiles: ProfilesService) {}

  @Get(':id/profile')
  @ApiZodResponse(200, PublicProfile)
  get(
    @CurrentUser() viewer: AuthPrincipal,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<PublicProfile> {
    return this.profiles.publicProfile(viewer.userId, id);
  }
}

/** Shared profile links (F-GRW-02): no login, only what a stranger may see. */
@ApiTags('profiles')
@Controller({ path: 'public/users', version: '1' })
export class PublicProfilesController {
  constructor(private readonly profiles: ProfilesService) {}

  @Get(':id')
  @Public()
  @RateLimit({ name: 'public-profile', limit: 300, windowSeconds: 3600, by: 'ip' })
  @ApiZodResponse(200, PublicProfileView)
  async get(@Param('id', new ParseUUIDPipe()) id: string): Promise<PublicProfileView> {
    const view = await this.profiles.shareView(id);
    if (!view) throw AppError.notFound('Profile');
    return view;
  }
}
