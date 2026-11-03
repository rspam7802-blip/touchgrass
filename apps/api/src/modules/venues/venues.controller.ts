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
  Venue,
  VenueFromPlaceBody,
  VenueList,
  VenueSearchQuery,
  VenueSearchResponse,
} from '@touchgrass/shared';
import { AppError } from '../../common/errors/app-error.js';
import { CurrentUser } from '../../common/auth/decorators.js';
import type { AuthPrincipal } from '../../common/http/request-context.js';
import { ApiZodBody, ApiZodQuery, ApiZodResponse } from '../../common/openapi/zod-openapi.js';
import { RateLimit } from '../../common/rate-limit/rate-limit.decorator.js';
import { ZodPipe } from '../../common/validation/zod.js';
import { VenuesService } from './venues.service.js';

@ApiTags('venues')
@ApiBearerAuth()
@Controller({ path: 'venues', version: '1' })
export class VenuesController {
  constructor(private readonly venues: VenuesService) {}

  /** Known venues plus Google Places suggestions for the "where" step of plotting. */
  @Get('search')
  @RateLimit({ name: 'venue-search', limit: 120, windowSeconds: 60, by: 'user' })
  @ApiZodQuery(VenueSearchQuery)
  @ApiZodResponse(200, VenueSearchResponse)
  async search(
    @Query(new ZodPipe(VenueSearchQuery)) q: Dto.VenueSearchQuery,
  ): Promise<Dto.VenueSearchResponse> {
    const near = { lat: q.lat, lng: q.lng };
    const [known, places] = await Promise.all([
      this.venues.search(q.q, near),
      this.venues.autocomplete(q.q, near, q.session),
    ]);
    return { venues: await this.venues.toDto(known), places };
  }

  @Post('from-place')
  @HttpCode(200)
  @ApiZodBody(VenueFromPlaceBody)
  @ApiZodResponse(200, Venue)
  async fromPlace(
    @CurrentUser() user: AuthPrincipal,
    @Body(new ZodPipe(VenueFromPlaceBody)) body: Dto.VenueFromPlaceBody,
  ): Promise<Dto.Venue> {
    const [dto] = await this.venues.toDto([
      await this.venues.fromPlace(body.placeId, body.sessionToken, user.userId),
    ]);
    if (!dto) throw AppError.notFound('Venue');
    return dto;
  }

  @Get('saved')
  @ApiZodResponse(200, VenueList)
  async saved(@CurrentUser() user: AuthPrincipal): Promise<Dto.VenueList> {
    return { items: await this.venues.toDto(await this.venues.saved(user.userId)) };
  }

  @Put('saved/:id')
  @HttpCode(204)
  async save(
    @CurrentUser() user: AuthPrincipal,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<void> {
    await this.venues.save(user.userId, id);
  }

  @Delete('saved/:id')
  @HttpCode(204)
  async unsave(
    @CurrentUser() user: AuthPrincipal,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<void> {
    await this.venues.unsave(user.userId, id);
  }
}
