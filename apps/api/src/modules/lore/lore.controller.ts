import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type * as Dto from '@touchgrass/shared';
import {
  AddLoreBody,
  LoreAlbum,
  LoreDownload,
  LoreQuery,
  LoreVisibilityBody,
} from '@touchgrass/shared';
import { z } from 'zod';
import { CurrentUser } from '../../common/auth/decorators.js';
import type { AuthPrincipal } from '../../common/http/request-context.js';
import { ApiZodBody, ApiZodQuery, ApiZodResponse } from '../../common/openapi/zod-openapi.js';
import { RateLimit } from '../../common/rate-limit/rate-limit.decorator.js';
import { ZodPipe } from '../../common/validation/zod.js';
import { LoreService } from './lore.service.js';

/** Lore albums (F-AFT-04). */
@ApiTags('lore')
@ApiBearerAuth()
@Controller({ version: '1' })
export class LoreController {
  constructor(private readonly lore: LoreService) {}

  @Get('events/:id/lore')
  @ApiZodQuery(LoreQuery)
  @ApiZodResponse(200, LoreAlbum)
  album(
    @CurrentUser() user: AuthPrincipal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Query(new ZodPipe(LoreQuery)) q: Dto.LoreQuery,
  ): Promise<Dto.LoreAlbum> {
    return this.lore.album(user.userId, id, q);
  }

  @Post('events/:id/lore')
  @RateLimit({ name: 'lore-add', limit: 60, windowSeconds: 3600, by: 'user' })
  @ApiZodBody(AddLoreBody)
  @ApiZodResponse(201, z.object({ id: z.uuid() }))
  add(
    @CurrentUser() user: AuthPrincipal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new ZodPipe(AddLoreBody)) body: Dto.AddLoreBody,
  ): Promise<{ id: string }> {
    return this.lore.add(user.userId, id, body);
  }

  @Put('events/:id/lore/visibility')
  @HttpCode(204)
  @ApiZodBody(LoreVisibilityBody)
  async visibility(
    @CurrentUser() user: AuthPrincipal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new ZodPipe(LoreVisibilityBody)) body: Dto.LoreVisibilityBody,
  ): Promise<void> {
    await this.lore.setVisibility(user.userId, id, body.visibility);
  }

  @Get('events/:id/lore/download')
  @RateLimit({ name: 'lore-download', limit: 20, windowSeconds: 3600, by: 'user' })
  @ApiZodResponse(200, LoreDownload)
  download(
    @CurrentUser() user: AuthPrincipal,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<Dto.LoreDownload> {
    return this.lore.download(user.userId, id);
  }

  @Delete('lore/:itemId')
  @HttpCode(204)
  async remove(
    @CurrentUser() user: AuthPrincipal,
    @Param('itemId', new ParseUUIDPipe()) itemId: string,
  ): Promise<void> {
    await this.lore.remove(user.userId, itemId);
  }
}
