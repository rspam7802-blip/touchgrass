import { InviteNetwork, type NetworkNode, resources } from '@touchgrass/shared';
import Link from 'next/link';
import { z } from 'zod';
import { canOpen } from '../../../../lib/admin-nav';
import { adminApi } from '../../../../lib/admin-session';
import { NoAccess } from '../../../../lib/admin-ui';
import { NetworkGraph } from './graph';
import { TimeSlider } from './slider';

const t = resources.en.admin.network;
const MAX_DRAWN = 400;
const day = new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium', timeZone: 'Asia/Kolkata' });
const nameOf = (n: { name: string | null; status: string }): string =>
  n.name ?? (n.status === 'deleted' ? t.deletedUser : resources.en.admin.customer.noName);
const fill = (s: string, vars: Record<string, string | number>): string =>
  Object.entries(vars).reduce((out, [k, v]) => out.replaceAll(`{{${k}}}`, String(v)), s);

const Params = z.object({
  until: z.iso.date().optional().catch(undefined),
  root: z.uuid().optional().catch(undefined),
  all: z.literal('1').optional().catch(undefined),
});

function href(p: { until?: string; root?: string; all?: boolean }): string {
  const q = new URLSearchParams();
  if (p.until) q.set('until', p.until);
  if (p.root) q.set('root', p.root);
  if (p.all) q.set('all', '1');
  const s = q.toString();
  return s ? `/admin/network?${s}` : '/admin/network';
}

function Tree({ node, kids }: { node: NetworkNode; kids: Map<string, NetworkNode[]> }) {
  const children = kids.get(node.id) ?? [];
  return (
    <li className="flex flex-col gap-1">
      <span>
        <Link href={`/admin/customers/${node.id}`} className="font-semibold underline">
          {nameOf(node)}
        </Link>{' '}
        <span className="text-sm text-muted">
          {fill(t.joined, { date: day.format(new Date(node.joinedAt)) })}
          {node.codeLabel ? ` · ${fill(t.via, { label: node.codeLabel })}` : ''}
          {node.direct > 0
            ? ` · ${fill(t.invitedCount, { direct: node.direct, total: node.descendants })}`
            : ''}
        </span>
      </span>
      {children.length > 0 ? (
        <ul className="ml-3 flex flex-col gap-1 border-l-2 border-border pl-4">
          {children.map((c) => (
            <Tree key={c.id} node={c} kids={kids} />
          ))}
        </ul>
      ) : null}
    </li>
  );
}

/** Invite network (D-193): our first invitees, who they brought in, and so on to the nth generation. */
export default async function NetworkPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  if (!(await canOpen('network'))) return <NoAccess />;
  const p = Params.parse(await searchParams);
  const q = new URLSearchParams();
  if (p.until) q.set('until', p.until);
  if (p.root) q.set('root', p.root);
  const net = await adminApi(
    `/v1/admin/network${q.size ? `?${q.toString()}` : ''}`,
    InviteNetwork,
    {},
    href({ until: p.until, root: p.root, all: p.all === '1' }),
  );
  const s = net.stats;
  const rootNode = p.root ? net.nodes.find((n) => n.id === p.root) : undefined;
  const ids = new Set(net.nodes.map((n) => n.id));
  const byId = new Map(net.nodes.map((n) => [n.id, n]));
  const inviterName = (i: { id: string; name: string | null }): string =>
    nameOf(byId.get(i.id) ?? { name: i.name, status: 'active' });
  const kids = new Map<string, NetworkNode[]>();
  for (const n of net.nodes)
    if (n.inviterId && ids.has(n.inviterId))
      kids.set(n.inviterId, [...(kids.get(n.inviterId) ?? []), n]);
  const roots = net.nodes.filter((n) => !n.inviterId || !ids.has(n.inviterId));
  const solo = roots.filter((n) => n.direct === 0);
  const showSolo = p.all === '1' || Boolean(p.root);
  const drawn = showSolo ? net.nodes : net.nodes.filter((n) => !solo.includes(n));
  const peak = Math.max(1, ...s.byGeneration.map((g) => g.count));

  return (
    <>
      <h1 className="text-3xl font-extrabold">
        {rootNode ? fill(t.familyOf, { name: nameOf(rootNode) }) : t.title}
      </h1>
      <p className="text-muted">{t.intro}</p>
      {p.root ? (
        <Link
          href={href({ until: p.until })}
          className="min-h-11 self-start font-semibold underline"
        >
          ← {t.allFamilies}
        </Link>
      ) : null}
      {net.firstJoinedAt ? (
        <TimeSlider
          first={net.firstJoinedAt}
          until={p.until ?? null}
          root={p.root ?? null}
          all={p.all === '1'}
          text={{ until: t.until, untilValue: t.untilValue, today: t.today }}
        />
      ) : null}
      {net.truncated ? <p role="status">{t.truncated}</p> : null}
      {net.nodes.length === 0 ? (
        <p className="admin-card">{t.empty}</p>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-5" data-testid="network-stats">
            {(
              [
                [t.people, s.people],
                [t.team, s.team],
                [t.member, s.member],
                [t.open, s.open],
                [t.deepest, s.deepest],
              ] as const
            ).map(([k, v]) => (
              <div key={k} className="admin-card flex flex-col gap-1">
                <span className="text-sm font-semibold text-muted">{k}</span>
                <span className="text-2xl font-extrabold">{v}</span>
              </div>
            ))}
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <section className="admin-card flex flex-col gap-3" aria-labelledby="by-gen">
              <h2 id="by-gen" className="font-bold">
                {t.byGeneration}
              </h2>
              <ul className="flex flex-col gap-2" data-testid="network-generations">
                {s.byGeneration.map((g) => (
                  <li key={g.generation} className="flex flex-col gap-1">
                    <span className="flex justify-between gap-2 text-sm">
                      <span className="font-semibold">
                        {g.generation === 1
                          ? t.generationOne
                          : fill(t.generation, { n: g.generation })}
                      </span>
                      <span>{g.count}</span>
                    </span>
                    <span aria-hidden="true" className="h-2 rounded-full bg-surface-alt">
                      <span
                        className="block h-2 rounded-full bg-primary"
                        style={{ width: `${String(Math.round((g.count / peak) * 100))}%` }}
                      />
                    </span>
                  </li>
                ))}
              </ul>
            </section>
            <section className="admin-card flex flex-col gap-3" aria-labelledby="top-inv">
              <h2 id="top-inv" className="font-bold">
                {t.topInviters}
              </h2>
              {s.topInviters.length === 0 ? <p className="text-sm text-muted">—</p> : null}
              <ol className="flex flex-col gap-2" data-testid="network-top">
                {s.topInviters.map((i) => (
                  <li key={i.id} className="flex flex-wrap items-center justify-between gap-2">
                    <span>
                      <Link href={`/admin/customers/${i.id}`} className="font-semibold underline">
                        {inviterName(i)}
                      </Link>{' '}
                      <span className="text-sm text-muted">
                        {fill(t.invitedCount, { direct: i.direct, total: i.descendants })}
                      </span>
                    </span>
                    <Link
                      href={href({ until: p.until, root: i.id })}
                      className="flex min-h-11 items-center rounded-full border-2 border-border px-4 text-sm font-semibold hover:bg-surface-alt"
                      aria-label={`${t.showFamily}: ${inviterName(i)}`}
                    >
                      {t.showFamily}
                    </Link>
                  </li>
                ))}
              </ol>
            </section>
          </div>

          <section className="flex flex-col gap-3" aria-labelledby="graph-h">
            <h2 id="graph-h" className="text-2xl font-extrabold">
              {t.graph}
            </h2>
            <p className="text-sm text-muted">{t.graphHint}</p>
            {!showSolo && solo.length > 0 ? (
              <p className="text-sm">
                {fill(t.hiddenSolo, { count: solo.length })}{' '}
                <Link
                  href={href({ until: p.until, all: true })}
                  className="font-semibold underline"
                >
                  {t.showSolo}
                </Link>
              </p>
            ) : null}
            {drawn.length === 0 ? null : drawn.length > MAX_DRAWN ? (
              <p className="admin-card">{t.graphTooBig}</p>
            ) : (
              <NetworkGraph nodes={drawn} nameOf={nameOf} label={t.graph} />
            )}
          </section>

          <details className="admin-card">
            <summary className="min-h-11 cursor-pointer font-bold">{t.list}</summary>
            <ul className="mt-3 flex flex-col gap-2" data-testid="network-list">
              {roots.map((r) => (
                <Tree key={r.id} node={r} kids={kids} />
              ))}
            </ul>
          </details>
        </>
      )}
    </>
  );
}
