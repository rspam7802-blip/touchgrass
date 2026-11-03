import { Injectable } from '@nestjs/common';
import type { MediaVariants } from '@touchgrass/shared';
import type { ConversationGate, GateAccess } from '../chat/conversation-gates.js';
import { CrewsService } from './crews.service.js';

/** Crew chats (F-ENG-02): active members read and write; admins run the group. */
@Injectable()
export class CrewChatGate implements ConversationGate {
  constructor(private readonly crews: CrewsService) {}

  async access(userId: string, crewId: string): Promise<GateAccess> {
    const a = await this.crews.chatAccess(userId, crewId);
    return {
      read: a.read,
      write: a.read,
      reason: a.read ? null : 'NOT_MEMBER',
      host: a.host,
      opensAt: null,
      closesAt: null,
    };
  }

  members(crewId: string): Promise<string[]> {
    return this.crews.activeMemberIds(crewId);
  }

  info(crewIds: string[]): Promise<Map<string, { title: string; avatar: MediaVariants | null }>> {
    return this.crews.chatInfo(crewIds);
  }
}
