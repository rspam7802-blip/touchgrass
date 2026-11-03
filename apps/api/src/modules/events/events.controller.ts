import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type * as Dto from '@touchgrass/shared';
import {
  AddHostBody,
  AttendeeList,
  BySlugQuery,
  CancelEventBody,
  CheckInBody,
  CheckInResult,
  ClaimPlusOneBody,
  ClaimPlusOneResult,
  CreateEventBody,
  EventDetail,
  EventList,
  InviteeList,
  InviteLink,
  InviteUsersBody,
  InviteUsersResult,
  MyEventsQuery,
  PlusOnePreview,
  PublicEventView,
  RsvpBody,
  RsvpResult,
  Ticket,
  UpdateEventBody,
} from '@touchgrass/shared';
import { z } from 'zod';
import { CurrentUser, Public } from '../../common/auth/decorators.js';
import type { AuthPrincipal } from '../../common/http/request-context.js';
import { Idempotent } from '../../common/idempotency/idempotency.js';
import { ApiZodBody, ApiZodQuery, ApiZodResponse } from '../../common/openapi/zod-openapi.js';
import { RateLimit } from '../../common/rate-limit/rate-limit.decorator.js';
import { ZodPipe } from '../../common/validation/zod.js';
import { CheckInService } from './check-in.service.js';
import { EventInvitesService } from './event-invites.service.js';
import { EventsService } from './events.service.js';
import { RsvpService } from './rsvp.service.js';

const Slug = z.string().regex(/^[A-Za-z0-9]{6,16}$/);
const Token = z.string().regex(/^[A-Za-z0-9_-]{20,100}$/);

@ApiTags('events')
@ApiBearerAuth()
@Controller({ path: 'events', version: '1' })
export class EventsController {
  constructor(
    private readonly events: EventsService,
    private readonly rsvps: RsvpService,
    private readonly invites: EventInvitesService,
    private readonly checkIns: CheckInService,
  ) {}

  @Post()
  @Idempotent()
  @RateLimit({ name: 'plot', limit: 20, windowSeconds: 86_400, by: 'user' })
  @ApiZodBody(CreateEventBody)
  @ApiZodResponse(201, EventDetail)
  create(
    @CurrentUser() user: AuthPrincipal,
    @Body(new ZodPipe(CreateEventBody)) body: Dto.CreateEventBody,
  ): Promise<Dto.EventDetail> {
    return this.events.create(user.userId, user.roles, body);
  }

  @Get('mine')
  @ApiZodQuery(MyEventsQuery)
  @ApiZodResponse(200, EventList)
  mine(
    @CurrentUser() user: AuthPrincipal,
    @Query(new ZodPipe(MyEventsQuery)) q: Dto.MyEventsQuery,
  ): Promise<Dto.EventList> {
    return this.events.mine(user.userId, q);
  }

  @Get('by-slug/:slug')
  @ApiZodQuery(BySlugQuery)
  @ApiZodResponse(200, EventDetail)
  async bySlug(
    @CurrentUser() user: AuthPrincipal,
    @Param('slug', new ZodPipe(Slug)) slug: string,
    @Query(new ZodPipe(BySlugQuery)) q: Dto.BySlugQuery,
  ): Promise<Dto.EventDetail> {
    const id = await this.events.idForSlug(slug);
    if (q.i) await this.invites.redeemLink(user.userId, id, q.i);
    return this.events.detailFor(user.userId, id);
  }

  @Get(':id')
  @ApiZodResponse(200, EventDetail)
  detail(
    @CurrentUser() user: AuthPrincipal,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<Dto.EventDetail> {
    return this.events.open(user.userId, id);
  }

  @Patch(':id')
  @ApiZodBody(UpdateEventBody)
  @ApiZodResponse(200, EventDetail)
  update(
    @CurrentUser() user: AuthPrincipal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new ZodPipe(UpdateEventBody)) body: Dto.UpdateEventBody,
  ): Promise<Dto.EventDetail> {
    return this.events.update(user.userId, id, body);
  }

  @Post(':id/publish')
  @HttpCode(200)
  @ApiZodResponse(200, EventDetail)
  publish(
    @CurrentUser() user: AuthPrincipal,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<Dto.EventDetail> {
    return this.events.publish(user.userId, id);
  }

  @Post(':id/cancel')
  @HttpCode(200)
  @Idempotent()
  @ApiZodBody(CancelEventBody)
  @ApiZodResponse(200, EventDetail)
  cancel(
    @CurrentUser() user: AuthPrincipal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new ZodPipe(CancelEventBody)) body: Dto.CancelEventBody,
  ): Promise<Dto.EventDetail> {
    return this.events.cancel(user.userId, id, body.reason);
  }

  @Put(':id/rsvp')
  @Idempotent()
  @RateLimit({ name: 'rsvp', limit: 60, windowSeconds: 3600, by: 'user' })
  @ApiZodBody(RsvpBody)
  @ApiZodResponse(200, RsvpResult)
  rsvp(
    @CurrentUser() user: AuthPrincipal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new ZodPipe(RsvpBody)) body: Dto.RsvpBody,
  ): Promise<Dto.RsvpResult> {
    return this.rsvps.rsvp(user.userId, id, body);
  }

  @Delete(':id/rsvp')
  @HttpCode(204)
  async leave(
    @CurrentUser() user: AuthPrincipal,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<void> {
    await this.rsvps.cancel(user.userId, id);
  }

  @Post(':id/waitlist/claim')
  @HttpCode(200)
  @Idempotent()
  @ApiZodResponse(200, RsvpResult)
  claim(
    @CurrentUser() user: AuthPrincipal,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<Dto.RsvpResult> {
    return this.rsvps.claimOffer(user.userId, id);
  }

  @Get(':id/attendees')
  @ApiZodResponse(200, AttendeeList)
  attendees(
    @CurrentUser() user: AuthPrincipal,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<Dto.AttendeeList> {
    return this.rsvps.attendees(user.userId, id);
  }

  @Post(':id/invites')
  @HttpCode(200)
  @RateLimit({ name: 'event-invite', limit: 300, windowSeconds: 86_400, by: 'user' })
  @ApiZodBody(InviteUsersBody)
  @ApiZodResponse(200, InviteUsersResult)
  invite(
    @CurrentUser() user: AuthPrincipal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new ZodPipe(InviteUsersBody)) body: Dto.InviteUsersBody,
  ): Promise<Dto.InviteUsersResult> {
    return this.invites.invite(user.userId, id, body.userIds);
  }

  @Post(':id/invite-links')
  @RateLimit({ name: 'event-invite-link', limit: 30, windowSeconds: 86_400, by: 'user' })
  @ApiZodResponse(201, InviteLink)
  inviteLink(
    @CurrentUser() user: AuthPrincipal,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<z.infer<typeof InviteLink>> {
    return this.invites.createLink(user.userId, id);
  }

  @Get(':id/invitees')
  @ApiZodResponse(200, InviteeList)
  invitees(
    @CurrentUser() user: AuthPrincipal,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<Dto.InviteeList> {
    return this.invites.invitees(user.userId, id);
  }

  @Post(':id/hosts')
  @HttpCode(200)
  @ApiZodBody(AddHostBody)
  @ApiZodResponse(200, EventDetail)
  addHost(
    @CurrentUser() user: AuthPrincipal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new ZodPipe(AddHostBody)) body: Dto.AddHostBody,
  ): Promise<Dto.EventDetail> {
    return this.events.addHost(user.userId, id, body);
  }

  @Delete(':id/hosts/:userId')
  @HttpCode(204)
  async removeHost(
    @CurrentUser() user: AuthPrincipal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('userId', new ParseUUIDPipe()) userId: string,
  ): Promise<void> {
    await this.events.removeHost(user.userId, id, userId);
  }

  @Get(':id/ticket')
  @ApiZodResponse(200, Ticket)
  ticket(
    @CurrentUser() user: AuthPrincipal,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<Dto.Ticket> {
    return this.checkIns.ticket(user.userId, id);
  }

  @Post(':id/check-in')
  @HttpCode(200)
  @RateLimit({ name: 'check-in', limit: 120, windowSeconds: 3600, by: 'user' })
  @ApiZodBody(CheckInBody)
  @ApiZodResponse(200, CheckInResult)
  checkIn(
    @CurrentUser() user: AuthPrincipal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new ZodPipe(CheckInBody)) body: Dto.CheckInBody,
  ): Promise<Dto.CheckInResult> {
    return this.checkIns.checkIn(user.userId, id, body);
  }
}

@ApiTags('events')
@Controller({ path: 'plus-ones', version: '1' })
export class PlusOnesController {
  constructor(private readonly rsvps: RsvpService) {}

  @Get(':token')
  @Public()
  @RateLimit({ name: 'plus-one-preview', limit: 60, windowSeconds: 3600, by: 'ip' })
  @ApiZodResponse(200, PlusOnePreview)
  preview(@Param('token', new ZodPipe(Token)) token: string): Promise<Dto.PlusOnePreview> {
    return this.rsvps.plusOnePreview(token);
  }

  @Post('claim')
  @HttpCode(200)
  @ApiBearerAuth()
  @Idempotent()
  @RateLimit({ name: 'plus-one-claim', limit: 20, windowSeconds: 3600, by: 'user' })
  @ApiZodBody(ClaimPlusOneBody)
  @ApiZodResponse(200, ClaimPlusOneResult)
  claim(
    @CurrentUser() user: AuthPrincipal,
    @Body(new ZodPipe(ClaimPlusOneBody)) body: Dto.ClaimPlusOneBody,
  ): Promise<Dto.ClaimPlusOneResult> {
    return this.rsvps.claimPlusOne(user.userId, body.token);
  }
}

/** Link previews for the web share page (F-EVT-17, F-WEB-01). Never includes an address. */
@ApiTags('events')
@Controller({ path: 'public/events', version: '1' })
export class PublicEventsController {
  constructor(private readonly events: EventsService) {}

  @Get(':slug')
  @Public()
  @RateLimit({ name: 'public-event', limit: 300, windowSeconds: 3600, by: 'ip' })
  @ApiZodResponse(200, PublicEventView)
  view(@Param('slug', new ZodPipe(Slug)) slug: string): Promise<Dto.PublicEventView> {
    return this.events.publicBySlug(slug);
  }
}
