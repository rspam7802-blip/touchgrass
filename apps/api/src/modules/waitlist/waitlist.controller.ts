import type * as Dto from '@touchgrass/shared';
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import {
  ADMIN_SECTIONS,
  LaunchWaitlistBody,
  LaunchWaitlistEntry,
  LaunchWaitlistInviteResult,
  LaunchWaitlistQuery,
  LaunchWaitlistResponse,
  paginated,
  WaitlistInsights,
  WaitlistInsightsQuery,
} from '@touchgrass/shared';
import { CurrentUser, Public, Roles } from '../../common/auth/decorators.js';
import type { AuthPrincipal } from '../../common/http/request-context.js';
import { ApiZodBody, ApiZodQuery, ApiZodResponse } from '../../common/openapi/zod-openapi.js';
import { RateLimit } from '../../common/rate-limit/rate-limit.decorator.js';
import { ZodPipe } from '../../common/validation/zod.js';
import { WaitlistService } from './waitlist.service.js';

const EntryPage = paginated(LaunchWaitlistEntry);

/** The website's waitlist form (D-169). Same answer for new and known contacts. */
@ApiTags('public')
@Controller({ path: 'public/waitlist', version: '1' })
export class WaitlistController {
  constructor(private readonly waitlist: WaitlistService) {}

  @Public()
  @Post()
  @HttpCode(200)
  @RateLimit({ name: 'launch-waitlist-ip', limit: 10, windowSeconds: 3600, by: 'ip' })
  @ApiZodBody(LaunchWaitlistBody)
  @ApiZodResponse(200, LaunchWaitlistResponse)
  async join(
    @Body(new ZodPipe(LaunchWaitlistBody)) body: Dto.LaunchWaitlistBody,
  ): Promise<Dto.LaunchWaitlistResponse> {
    await this.waitlist.submit(body);
    return { received: true };
  }
}

/** Admin side of the launch waitlist (F-WEB-03, D-169). Every change is audited in its transaction. */
@ApiTags('admin')
@ApiBearerAuth()
@Controller({ path: 'admin/waitlist', version: '1' })
export class WaitlistAdminController {
  constructor(private readonly waitlist: WaitlistService) {}

  @Get()
  @Roles(...ADMIN_SECTIONS.waitlist)
  @ApiZodQuery(LaunchWaitlistQuery)
  @ApiZodResponse(200, EntryPage)
  list(
    @Query(new ZodPipe(LaunchWaitlistQuery)) q: Dto.LaunchWaitlistQuery,
  ): Promise<Dto.Paginated<Dto.LaunchWaitlistEntry>> {
    return this.waitlist.list(q);
  }

  @Get('insights')
  @Roles(...ADMIN_SECTIONS.waitlist)
  @ApiZodQuery(WaitlistInsightsQuery)
  @ApiZodResponse(200, WaitlistInsights)
  insights(
    @Query(new ZodPipe(WaitlistInsightsQuery)) q: Dto.WaitlistInsightsQuery,
  ): Promise<Dto.WaitlistInsights> {
    return this.waitlist.insights(q);
  }

  /** Creating codes is the invite-codes section's power, so only its roles may invite. */
  @Post(':id/invite')
  @HttpCode(200)
  @Roles(...ADMIN_SECTIONS.inviteCodes)
  @ApiZodResponse(200, LaunchWaitlistInviteResult)
  invite(
    @CurrentUser() admin: AuthPrincipal,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<Dto.LaunchWaitlistInviteResult> {
    return this.waitlist.invite(admin.userId, id);
  }

  /** Someone invited who never signed up gets a fresh code (D-195); same power as inviting. */
  @Post(':id/reinvite')
  @HttpCode(200)
  @Roles(...ADMIN_SECTIONS.inviteCodes)
  @ApiZodResponse(200, LaunchWaitlistInviteResult)
  reinvite(
    @CurrentUser() admin: AuthPrincipal,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<Dto.LaunchWaitlistInviteResult> {
    return this.waitlist.reinvite(admin.userId, id);
  }

  @Delete(':id')
  @HttpCode(204)
  @Roles(...ADMIN_SECTIONS.waitlist)
  async remove(
    @CurrentUser() admin: AuthPrincipal,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<void> {
    await this.waitlist.remove(admin.userId, id);
  }
}
