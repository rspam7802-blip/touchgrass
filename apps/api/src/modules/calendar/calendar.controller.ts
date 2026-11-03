import { Controller, Get, Header, HttpCode, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type * as Dto from '@touchgrass/shared';
import { CalendarFeed } from '@touchgrass/shared';
import { z } from 'zod';
import { CurrentUser, Public } from '../../common/auth/decorators.js';
import type { AuthPrincipal } from '../../common/http/request-context.js';
import { ApiZodResponse } from '../../common/openapi/zod-openapi.js';
import { RateLimit } from '../../common/rate-limit/rate-limit.decorator.js';
import { ZodPipe } from '../../common/validation/zod.js';
import { CalendarService } from './calendar.service.js';

const FeedToken = z.string().regex(/^[0-9a-f-]{36}\.\d{1,9}\.[A-Za-z0-9_-]{43}\.ics$/);

/** Calendar sync (F-CAL-01). */
@ApiTags('calendar')
@Controller({ version: '1' })
export class CalendarController {
  constructor(private readonly calendar: CalendarService) {}

  @Get('me/calendar')
  @ApiBearerAuth()
  @ApiZodResponse(200, CalendarFeed)
  feed(@CurrentUser() user: AuthPrincipal): Promise<Dto.CalendarFeed> {
    return this.calendar.feed(user.userId);
  }

  @Post('me/calendar/reset')
  @HttpCode(200)
  @ApiBearerAuth()
  @RateLimit({ name: 'calendar-reset', limit: 10, windowSeconds: 86_400, by: 'user' })
  @ApiZodResponse(200, CalendarFeed)
  reset(@CurrentUser() user: AuthPrincipal): Promise<Dto.CalendarFeed> {
    return this.calendar.reset(user.userId);
  }

  @Get('events/:id/calendar.ics')
  @ApiBearerAuth()
  @Header('content-type', 'text/calendar; charset=utf-8')
  @Header('content-disposition', 'attachment; filename="touchgrass-plan.ics"')
  @Header('cache-control', 'private, no-store')
  eventIcs(
    @CurrentUser() user: AuthPrincipal,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<string> {
    return this.calendar.eventIcs(user.userId, id);
  }

  /** Polled by calendar apps; the token in the path is the only credential. */
  @Get('calendar/:file')
  @Public()
  @RateLimit({ name: 'calendar-feed', limit: 120, windowSeconds: 3600, by: 'ip' })
  @Header('content-type', 'text/calendar; charset=utf-8')
  @Header('cache-control', 'private, max-age=300')
  @Header('x-robots-tag', 'noindex')
  feedIcs(@Param('file', new ZodPipe(FeedToken)) file: string): Promise<string> {
    return this.calendar.feedIcs(file.slice(0, -'.ics'.length));
  }
}
