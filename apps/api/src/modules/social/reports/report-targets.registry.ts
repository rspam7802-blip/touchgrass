import { Injectable } from '@nestjs/common';
import type { ReportTargetType } from '@touchgrass/shared';

export interface ReportTargetResolver {
  type: ReportTargetType;
  /** Returns the target's city (for curator routing), or null when it does not exist / is invisible to the reporter. */
  resolve(
    reporterId: string,
    targetId: string,
  ): Promise<{ cityId: string | null; ownerUserId: string | null } | null>;
}

/**
 * Each content module registers how to find what is being reported (users now; events, messages and Lore
 * register themselves in later phases), so reports never reach into other modules' tables.
 */
@Injectable()
export class ReportTargetRegistry {
  private readonly resolvers = new Map<ReportTargetType, ReportTargetResolver>();

  register(resolver: ReportTargetResolver): void {
    if (this.resolvers.has(resolver.type))
      throw new Error(`Duplicate report resolver ${resolver.type}`);
    this.resolvers.set(resolver.type, resolver);
  }

  get(type: ReportTargetType): ReportTargetResolver | undefined {
    return this.resolvers.get(type);
  }
}
