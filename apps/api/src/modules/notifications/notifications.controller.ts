import { Body, Controller, Get, HttpCode, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type * as Dto from '@touchgrass/shared';
import {
  LIMITS,
  MarkNotificationsReadBody,
  NotificationPage,
  QuietHours,
  UnreadCount,
} from '@touchgrass/shared';
import { z } from 'zod';
import { CurrentUser } from '../../common/auth/decorators.js';
import type { AuthPrincipal } from '../../common/http/request-context.js';
import { ApiZodBody, ApiZodQuery, ApiZodResponse } from '../../common/openapi/zod-openapi.js';
import { ZodPipe } from '../../common/validation/zod.js';
import { NotificationsService } from './notifications.service.js';

const InboxQuery = z.object({
  cursor: z.string().max(512).optional(),
  limit: z.coerce.number().int().min(1).max(LIMITS.notifications.inboxPageMax).default(30),
});

/** The notification inbox and quiet hours (F-NOT-01). */
@ApiTags('notifications')
@ApiBearerAuth()
@Controller({ version: '1' })
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Get('notifications')
  @ApiZodQuery(InboxQuery)
  @ApiZodResponse(200, NotificationPage)
  inbox(
    @CurrentUser() user: AuthPrincipal,
    @Query(new ZodPipe(InboxQuery)) q: z.infer<typeof InboxQuery>,
  ): Promise<Dto.NotificationPage> {
    return this.notifications.page(user.userId, q.cursor, q.limit);
  }

  @Get('notifications/unread')
  @ApiZodResponse(200, UnreadCount)
  async unread(@CurrentUser() user: AuthPrincipal): Promise<Dto.UnreadCount> {
    return { unread: await this.notifications.unread(user.userId) };
  }

  @Post('notifications/read')
  @HttpCode(200)
  @ApiZodBody(MarkNotificationsReadBody)
  @ApiZodResponse(200, UnreadCount)
  async read(
    @CurrentUser() user: AuthPrincipal,
    @Body(new ZodPipe(MarkNotificationsReadBody)) body: Dto.MarkNotificationsReadBody,
  ): Promise<Dto.UnreadCount> {
    return { unread: await this.notifications.markRead(user.userId, body) };
  }

  @Get('me/settings/quiet-hours')
  @ApiZodResponse(200, QuietHours)
  quiet(@CurrentUser() user: AuthPrincipal): Promise<Dto.QuietHours> {
    return this.notifications.quietHours(user.userId);
  }

  @Put('me/settings/quiet-hours')
  @ApiZodBody(QuietHours)
  @ApiZodResponse(200, QuietHours)
  setQuiet(
    @CurrentUser() user: AuthPrincipal,
    @Body(new ZodPipe(QuietHours)) body: Dto.QuietHours,
  ): Promise<Dto.QuietHours> {
    return this.notifications.setQuietHours(user.userId, body);
  }
}
