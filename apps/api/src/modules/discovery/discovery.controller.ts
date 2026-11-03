import { Body, Controller, Get, HttpCode, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type * as Dto from '@touchgrass/shared';
import {
  Feed,
  FeedClickBody,
  FeedQuery,
  MapQuery,
  MapResponse,
  SearchQuery,
  SearchResponse,
} from '@touchgrass/shared';
import { CurrentUser } from '../../common/auth/decorators.js';
import type { AuthPrincipal } from '../../common/http/request-context.js';
import { ApiZodBody, ApiZodQuery, ApiZodResponse } from '../../common/openapi/zod-openapi.js';
import { RateLimit } from '../../common/rate-limit/rate-limit.decorator.js';
import { ZodPipe } from '../../common/validation/zod.js';
import { DiscoveryService } from './discovery.service.js';
import { SearchService } from './search.service.js';

@ApiTags('discovery')
@ApiBearerAuth()
@Controller({ path: 'discover', version: '1' })
export class DiscoveryController {
  constructor(
    private readonly discovery: DiscoveryService,
    private readonly searchService: SearchService,
  ) {}

  @Get('feed')
  @RateLimit({ name: 'feed', limit: 240, windowSeconds: 60, by: 'user' })
  @ApiZodQuery(FeedQuery)
  @ApiZodResponse(200, Feed)
  feed(
    @CurrentUser() user: AuthPrincipal,
    @Query(new ZodPipe(FeedQuery)) q: Dto.FeedQuery,
  ): Promise<Dto.Feed> {
    return this.discovery.feed(user.userId, q);
  }

  @Post('clicks')
  @HttpCode(204)
  @RateLimit({ name: 'feed-click', limit: 300, windowSeconds: 3600, by: 'user' })
  @ApiZodBody(FeedClickBody)
  async click(
    @CurrentUser() user: AuthPrincipal,
    @Body(new ZodPipe(FeedClickBody)) body: Dto.FeedClickBody,
  ): Promise<void> {
    await this.discovery.click(user.userId, body);
  }

  @Get('map')
  @RateLimit({ name: 'map', limit: 120, windowSeconds: 60, by: 'user' })
  @ApiZodQuery(MapQuery)
  @ApiZodResponse(200, MapResponse)
  map(
    @CurrentUser() user: AuthPrincipal,
    @Query(new ZodPipe(MapQuery)) q: Dto.MapQuery,
  ): Promise<Dto.MapResponse> {
    return this.discovery.map(user.userId, q);
  }

  @Get('search')
  @RateLimit({ name: 'search', limit: 60, windowSeconds: 60, by: 'user' })
  @ApiZodQuery(SearchQuery)
  @ApiZodResponse(200, SearchResponse)
  search(
    @CurrentUser() user: AuthPrincipal,
    @Query(new ZodPipe(SearchQuery)) q: Dto.SearchQuery,
  ): Promise<Dto.SearchResponse> {
    return this.searchService.search(user.userId, q);
  }
}
