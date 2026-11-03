import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type * as Dto from '@touchgrass/shared';
import {
  AddProposalOptionBody,
  CreateProposalBody,
  LockProposalBody,
  ProposalDetail,
  ProposalList,
  ProposalVoteBody,
} from '@touchgrass/shared';
import { CurrentUser } from '../../common/auth/decorators.js';
import type { AuthPrincipal } from '../../common/http/request-context.js';
import { Idempotent } from '../../common/idempotency/idempotency.js';
import { ApiZodBody, ApiZodResponse } from '../../common/openapi/zod-openapi.js';
import { RateLimit } from '../../common/rate-limit/rate-limit.decorator.js';
import { ZodPipe } from '../../common/validation/zod.js';
import { ProposalsService } from './proposals.service.js';

/** Collaborative plans (F-ENG-03). */
@ApiTags('proposals')
@ApiBearerAuth()
@Controller({ path: 'proposals', version: '1' })
export class ProposalsController {
  constructor(private readonly proposals: ProposalsService) {}

  @Get()
  @ApiZodResponse(200, ProposalList)
  list(@CurrentUser() user: AuthPrincipal): Promise<Dto.ProposalList> {
    return this.proposals.list(user.userId);
  }

  @Post()
  @Idempotent()
  @RateLimit({ name: 'proposal-create', limit: 20, windowSeconds: 86_400, by: 'user' })
  @ApiZodBody(CreateProposalBody)
  @ApiZodResponse(201, ProposalDetail)
  create(
    @CurrentUser() user: AuthPrincipal,
    @Body(new ZodPipe(CreateProposalBody)) body: Dto.CreateProposalBody,
  ): Promise<Dto.ProposalDetail> {
    return this.proposals.create(user.userId, body);
  }

  @Get(':id')
  @ApiZodResponse(200, ProposalDetail)
  detail(
    @CurrentUser() user: AuthPrincipal,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<Dto.ProposalDetail> {
    return this.proposals.detail(user.userId, id);
  }

  @Post(':id/options')
  @RateLimit({ name: 'proposal-option', limit: 60, windowSeconds: 3600, by: 'user' })
  @ApiZodBody(AddProposalOptionBody)
  @ApiZodResponse(201, ProposalDetail)
  addOption(
    @CurrentUser() user: AuthPrincipal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new ZodPipe(AddProposalOptionBody)) body: Dto.AddProposalOptionBody,
  ): Promise<Dto.ProposalDetail> {
    return this.proposals.addOption(user.userId, id, body);
  }

  @Post(':id/votes')
  @HttpCode(200)
  @RateLimit({ name: 'proposal-vote', limit: 300, windowSeconds: 3600, by: 'user' })
  @ApiZodBody(ProposalVoteBody)
  @ApiZodResponse(200, ProposalDetail)
  vote(
    @CurrentUser() user: AuthPrincipal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new ZodPipe(ProposalVoteBody)) body: Dto.ProposalVoteBody,
  ): Promise<Dto.ProposalDetail> {
    return this.proposals.vote(user.userId, id, body);
  }

  @Post(':id/lock')
  @HttpCode(200)
  @Idempotent()
  @ApiZodBody(LockProposalBody)
  @ApiZodResponse(200, ProposalDetail)
  lock(
    @CurrentUser() user: AuthPrincipal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new ZodPipe(LockProposalBody)) body: Dto.LockProposalBody,
  ): Promise<Dto.ProposalDetail> {
    return this.proposals.lock(user.userId, id, body);
  }

  @Post(':id/cancel')
  @HttpCode(200)
  @ApiZodResponse(200, ProposalDetail)
  cancel(
    @CurrentUser() user: AuthPrincipal,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<Dto.ProposalDetail> {
    return this.proposals.cancel(user.userId, id);
  }
}
