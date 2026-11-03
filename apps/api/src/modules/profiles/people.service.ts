import { Injectable } from '@nestjs/common';
import type { PersonCard } from '@touchgrass/shared';
import { SocialGraphService } from '../social/graph/social-graph.service.js';
import { UsersService } from '../users/users.service.js';
import { ProfilesService } from './profiles.service.js';

/**
 * Builds compact person cards for lists (squad, requests, suggestions, contact matches, activity).
 * Blocked, inactive and nameless accounts are dropped; input order is preserved.
 */
@Injectable()
export class PeopleService {
  constructor(
    private readonly users: UsersService,
    private readonly profiles: ProfilesService,
    private readonly graph: SocialGraphService,
  ) {}

  /** `includeSelf` keeps the viewer's own card (e.g. when they are listed as a host). */
  async cards(
    viewerId: string,
    ids: string[],
    opts: { includeSelf?: boolean } = {},
  ): Promise<Map<string, PersonCard>> {
    const unique = [...new Set(ids)].filter((id) => opts.includeSelf === true || id !== viewerId);
    if (unique.length === 0) return new Map();
    const blocked = await this.graph.blockedSet(viewerId);
    const candidates = unique.filter((id) => !blocked.has(id));
    const [active, names, photos, mutuals, verified] = await Promise.all([
      this.users.activeIds(candidates),
      this.profiles.displayNames(candidates),
      this.profiles.primaryPhotos(candidates),
      this.graph.mutualCounts(viewerId, candidates),
      this.users.verifiedIds(candidates),
    ]);
    const out = new Map<string, PersonCard>();
    for (const id of candidates) {
      const displayName = names.get(id);
      if (!active.has(id) || !displayName) continue;
      out.set(id, {
        id,
        displayName,
        photo: photos.get(id) ?? null,
        verified: verified.has(id),
        mutualFriendCount: mutuals.get(id) ?? 0,
      });
    }
    return out;
  }

  async list(viewerId: string, ids: string[]): Promise<PersonCard[]> {
    const cards = await this.cards(viewerId, ids);
    return ids.flatMap((id) => {
      const c = cards.get(id);
      return c ? [c] : [];
    });
  }
}
