import { Injectable } from '@nestjs/common';
import {
  type InviteNetwork,
  type InviteNetworkQuery,
  inviteForest,
  type NetworkNode,
} from '@touchgrass/shared';
import { InvitesService } from '../invites/invites.service.js';
import { ProfilesService } from '../profiles/profiles.service.js';
import { UsersService } from '../users/users.service.js';

const MAX_PEOPLE = 20_000;
const TOP_INVITERS = 10;

/** End of an IST calendar day, as an instant. */
export const endOfIstDay = (day: string): Date => new Date(`${day}T23:59:59.999+05:30`);

/**
 * The invite network (D-193): generation 1 came in through a team code (or with no code at all), generation 2
 * was invited by a generation-1 member, and so on. Built from the users and invites modules' own reads.
 */
@Injectable()
export class NetworkService {
  constructor(
    private readonly users: UsersService,
    private readonly invites: InvitesService,
    private readonly profiles: ProfilesService,
  ) {}

  async network(q: InviteNetworkQuery): Promise<InviteNetwork> {
    const rows = await this.users.inviteEdges(
      q.until ? endOfIstDay(q.until) : null,
      MAX_PEOPLE + 1,
    );
    const truncated = rows.length > MAX_PEOPLE;
    const people = rows.slice(0, MAX_PEOPLE);
    const ids = people.map((p) => p.id);
    const [entries, names] = await Promise.all([
      this.invites.entriesOf(ids),
      this.profiles.displayNames(ids),
    ]);
    const shaped = people.map((p) => {
      const e = entries.get(p.id);
      const entry: NetworkNode['entry'] =
        e?.source === 'admin' ? 'team' : p.inviterId || e?.source === 'user' ? 'member' : 'open';
      return {
        ...p,
        entry,
        joinedAt: e?.at ?? p.createdAt,
        codeLabel: e?.source === 'admin' ? e.label : null,
      };
    });
    const forest = inviteForest(shaped);
    let nodes: NetworkNode[] = shaped.map((p) => {
      const f = forest.get(p.id) ?? { generation: 1, direct: 0, descendants: 0 };
      return {
        id: p.id,
        name: p.status === 'deleted' ? null : (names.get(p.id) ?? null),
        status: p.status,
        joinedAt: p.joinedAt.toISOString(),
        entry: p.entry,
        inviterId: p.inviterId && forest.has(p.inviterId) ? p.inviterId : null,
        codeLabel: p.codeLabel,
        ...f,
      };
    });
    if (q.root) {
      const keep = new Set([q.root]);
      // Oldest first, so an inviter is always kept before the people they invited.
      for (const n of nodes) if (n.inviterId && keep.has(n.inviterId)) keep.add(n.id);
      nodes = nodes.filter((n) => keep.has(n.id));
    }
    const gens = new Map<number, number>();
    for (const n of nodes) gens.set(n.generation, (gens.get(n.generation) ?? 0) + 1);
    return {
      nodes,
      truncated,
      firstJoinedAt: shaped[0]?.joinedAt.toISOString() ?? null,
      stats: {
        people: nodes.length,
        team: nodes.filter((n) => n.entry === 'team').length,
        member: nodes.filter((n) => n.entry === 'member').length,
        open: nodes.filter((n) => n.entry === 'open').length,
        deepest: Math.max(0, ...nodes.map((n) => n.generation)),
        byGeneration: [...gens.entries()]
          .sort((a, b) => a[0] - b[0])
          .map(([generation, count]) => ({ generation, count })),
        topInviters: nodes
          .filter((n) => n.direct > 0)
          .sort((a, b) => b.descendants - a.descendants || b.direct - a.direct)
          .slice(0, TOP_INVITERS)
          .map((n) => ({ id: n.id, name: n.name, direct: n.direct, descendants: n.descendants })),
      },
    };
  }
}
