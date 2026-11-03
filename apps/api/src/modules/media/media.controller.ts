import type * as Dto from '@touchgrass/shared';
import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CreateUploadBody, CreateUploadResponse, MediaAsset } from '@touchgrass/shared';
import { AllowOnboarding, CurrentUser } from '../../common/auth/decorators.js';
import type { AuthPrincipal } from '../../common/http/request-context.js';
import { ApiZodBody, ApiZodResponse } from '../../common/openapi/zod-openapi.js';
import { RateLimit } from '../../common/rate-limit/rate-limit.decorator.js';
import { ZodPipe } from '../../common/validation/zod.js';
import { MediaService } from './media.service.js';

@ApiTags('media')
@ApiBearerAuth()
@AllowOnboarding()
@Controller({ path: 'media', version: '1' })
export class MediaController {
  constructor(private readonly media: MediaService) {}

  @Post('uploads')
  @RateLimit({ name: 'media-upload', limit: 60, windowSeconds: 3600, by: 'user' })
  @ApiZodBody(CreateUploadBody)
  @ApiZodResponse(201, CreateUploadResponse)
  createUpload(
    @CurrentUser() user: AuthPrincipal,
    @Body(new ZodPipe(CreateUploadBody)) body: Dto.CreateUploadBody,
  ): Promise<CreateUploadResponse> {
    return this.media.createUpload(user.userId, body);
  }

  @Post(':id/complete')
  @HttpCode(200)
  @ApiZodResponse(200, MediaAsset)
  complete(
    @CurrentUser() user: AuthPrincipal,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<MediaAsset> {
    return this.media.complete(user.userId, id);
  }

  @Get(':id')
  @ApiZodResponse(200, MediaAsset)
  get(
    @CurrentUser() user: AuthPrincipal,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<MediaAsset> {
    return this.media.get(user.userId, id);
  }
}
