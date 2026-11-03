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
  Res,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type * as Dto from '@touchgrass/shared';
import {
  ConversationList,
  ConversationListQuery,
  ConversationSummary,
  CreatePollBody,
  DeleteMessageQuery,
  Message,
  MessagePage,
  MessagePageQuery,
  MuteBody,
  PollView,
  ReactBody,
  ReadBody,
  RespondRequestBody,
  SendMessageBody,
  StartDirectBody,
  VoteBody,
} from '@touchgrass/shared';
import type { Response } from 'express';
import { CurrentUser } from '../../common/auth/decorators.js';
import type { AuthPrincipal } from '../../common/http/request-context.js';
import { ApiZodBody, ApiZodQuery, ApiZodResponse } from '../../common/openapi/zod-openapi.js';
import { RateLimit } from '../../common/rate-limit/rate-limit.decorator.js';
import { ZodPipe } from '../../common/validation/zod.js';
import { ChatPollsService } from './chat-polls.service.js';
import { ChatService } from './chat.service.js';

@ApiTags('chat')
@ApiBearerAuth()
@Controller({ path: 'chats', version: '1' })
export class ChatController {
  constructor(
    private readonly chat: ChatService,
    private readonly polls: ChatPollsService,
  ) {}

  @Get()
  @ApiZodQuery(ConversationListQuery)
  @ApiZodResponse(200, ConversationList)
  list(
    @CurrentUser() user: AuthPrincipal,
    @Query(new ZodPipe(ConversationListQuery)) q: Dto.ConversationListQuery,
  ): Promise<Dto.ConversationList> {
    return this.chat.list(user.userId, q);
  }

  @Post('direct')
  @RateLimit({ name: 'chat-start', limit: 60, windowSeconds: 3600, by: 'user' })
  @ApiZodBody(StartDirectBody)
  @ApiZodResponse(201, ConversationSummary)
  start(
    @CurrentUser() user: AuthPrincipal,
    @Body(new ZodPipe(StartDirectBody)) body: Dto.StartDirectBody,
  ): Promise<Dto.ConversationSummary> {
    return this.chat.startDirect(user.userId, body.userId);
  }

  @Get(':id')
  @ApiZodResponse(200, ConversationSummary)
  get(
    @CurrentUser() user: AuthPrincipal,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<Dto.ConversationSummary> {
    return this.chat.summary(user.userId, id);
  }

  /** Accept (200 with the chat) or decline (204, silently) a message request. */
  @Post(':id/request')
  @ApiZodBody(RespondRequestBody)
  @ApiZodResponse(200, ConversationSummary)
  async respond(
    @CurrentUser() user: AuthPrincipal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new ZodPipe(RespondRequestBody)) body: Dto.RespondRequestBody,
    @Res({ passthrough: true }) res: Response,
  ): Promise<Dto.ConversationSummary | undefined> {
    const out = await this.chat.respondToRequest(user.userId, id, body.accept);
    if (out) {
      res.status(200);
      return out;
    }
    res.status(204);
    return undefined;
  }

  @Get(':id/messages')
  @ApiZodQuery(MessagePageQuery)
  @ApiZodResponse(200, MessagePage)
  messages(
    @CurrentUser() user: AuthPrincipal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Query(new ZodPipe(MessagePageQuery)) q: Dto.MessagePageQuery,
  ): Promise<Dto.MessagePage> {
    return this.chat.page(user.userId, id, q.cursor, q.limit);
  }

  /** Not @Idempotent: the body's clientId de-duplicates retries for a week (offline queue). */
  @Post(':id/messages')
  @RateLimit({ name: 'chat-send', limit: 60, windowSeconds: 60, by: 'user' })
  @ApiZodBody(SendMessageBody)
  @ApiZodResponse(201, Message)
  send(
    @CurrentUser() user: AuthPrincipal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new ZodPipe(SendMessageBody)) body: Dto.SendMessageBody,
  ): Promise<Dto.Message> {
    return this.chat.send(user.userId, id, body);
  }

  @Get(':id/messages/:messageId')
  @ApiZodResponse(200, Message)
  message(
    @CurrentUser() user: AuthPrincipal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('messageId', new ParseUUIDPipe()) messageId: string,
  ): Promise<Dto.Message> {
    return this.chat.message(user.userId, id, messageId);
  }

  @Delete(':id/messages/:messageId')
  @HttpCode(204)
  @ApiZodQuery(DeleteMessageQuery)
  async remove(
    @CurrentUser() user: AuthPrincipal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('messageId', new ParseUUIDPipe()) messageId: string,
    @Query(new ZodPipe(DeleteMessageQuery)) q: Dto.DeleteMessageQuery,
  ): Promise<void> {
    await this.chat.deleteMessage(user.userId, id, messageId, q.scope);
  }

  @Post(':id/messages/:messageId/reactions')
  @HttpCode(200)
  @RateLimit({ name: 'chat-react', limit: 120, windowSeconds: 60, by: 'user' })
  @ApiZodBody(ReactBody)
  @ApiZodResponse(200, Message)
  react(
    @CurrentUser() user: AuthPrincipal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('messageId', new ParseUUIDPipe()) messageId: string,
    @Body(new ZodPipe(ReactBody)) body: Dto.ReactBody,
  ): Promise<Dto.Message> {
    return this.chat.react(user.userId, id, messageId, body.emoji, true);
  }

  @Delete(':id/messages/:messageId/reactions')
  @ApiZodQuery(ReactBody)
  @ApiZodResponse(200, Message)
  unreact(
    @CurrentUser() user: AuthPrincipal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('messageId', new ParseUUIDPipe()) messageId: string,
    @Query(new ZodPipe(ReactBody)) q: Dto.ReactBody,
  ): Promise<Dto.Message> {
    return this.chat.react(user.userId, id, messageId, q.emoji, false);
  }

  @Post(':id/read')
  @HttpCode(204)
  @ApiZodBody(ReadBody)
  async read(
    @CurrentUser() user: AuthPrincipal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new ZodPipe(ReadBody)) body: Dto.ReadBody,
  ): Promise<void> {
    await this.chat.markRead(user.userId, id, body.messageId);
  }

  @Put(':id/mute')
  @ApiZodBody(MuteBody)
  @ApiZodResponse(200, ConversationSummary)
  mute(
    @CurrentUser() user: AuthPrincipal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new ZodPipe(MuteBody)) body: Dto.MuteBody,
  ): Promise<Dto.ConversationSummary> {
    return this.chat.mute(user.userId, id, body);
  }

  @Post(':id/polls')
  @RateLimit({ name: 'poll-create', limit: 20, windowSeconds: 3600, by: 'user' })
  @ApiZodBody(CreatePollBody)
  @ApiZodResponse(201, Message)
  createPoll(
    @CurrentUser() user: AuthPrincipal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new ZodPipe(CreatePollBody)) body: Dto.CreatePollBody,
  ): Promise<Dto.Message> {
    return this.polls.create(user.userId, id, body);
  }
}

@ApiTags('chat')
@ApiBearerAuth()
@Controller({ path: 'polls', version: '1' })
export class PollsController {
  constructor(private readonly polls: ChatPollsService) {}

  @Post(':id/votes')
  @HttpCode(200)
  @RateLimit({ name: 'poll-vote', limit: 60, windowSeconds: 60, by: 'user' })
  @ApiZodBody(VoteBody)
  @ApiZodResponse(200, PollView)
  vote(
    @CurrentUser() user: AuthPrincipal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new ZodPipe(VoteBody)) body: Dto.VoteBody,
  ): Promise<Dto.PollView> {
    return this.polls.vote(user.userId, id, body.optionIds);
  }

  @Post(':id/close')
  @HttpCode(200)
  @ApiZodResponse(200, PollView)
  close(
    @CurrentUser() user: AuthPrincipal,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<Dto.PollView> {
    return this.polls.close(user.userId, id);
  }
}

@ApiTags('chat')
@ApiBearerAuth()
@Controller({ path: 'events', version: '1' })
export class EventChatController {
  constructor(private readonly chat: ChatService) {}

  /** The plan's group chat; joining happens on first visit (seat holders and hosts only). */
  @Get(':id/chat')
  @ApiZodResponse(200, ConversationSummary)
  eventChat(
    @CurrentUser() user: AuthPrincipal,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<Dto.ConversationSummary> {
    return this.chat.eventConversation(user.userId, id);
  }
}
