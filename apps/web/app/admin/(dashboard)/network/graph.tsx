import type { NetworkNode } from '@touchgrass/shared';

const COL = 230;
const ROW = 40;
const PAD = 16;
const day = new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium', timeZone: 'Asia/Kolkata' });

/**
 * The invite forest drawn left to right (D-193): generation 1 in the first column, the people they invited in
 * the next, and so on. Leaves take one row each; a parent sits level with the middle of its children.
 */
export function NetworkGraph({
  nodes,
  nameOf,
  label,
}: {
  nodes: NetworkNode[];
  nameOf: (n: NetworkNode) => string;
  label: string;
}) {
  const ids = new Set(nodes.map((n) => n.id));
  const kids = new Map<string, NetworkNode[]>();
  for (const n of nodes)
    if (n.inviterId && ids.has(n.inviterId))
      kids.set(n.inviterId, [...(kids.get(n.inviterId) ?? []), n]);
  const roots = nodes.filter((n) => !n.inviterId || !ids.has(n.inviterId));
  const base = Math.min(...nodes.map((n) => n.generation));
  const pos = new Map<string, { x: number; y: number }>();
  let row = 0;
  const place = (n: NetworkNode): number => {
    const children = kids.get(n.id) ?? [];
    let y: number;
    if (children.length === 0) {
      y = row * ROW;
      row += 1;
    } else {
      const ys = children.map(place);
      y = ((ys[0] ?? 0) + (ys[ys.length - 1] ?? 0)) / 2;
    }
    pos.set(n.id, { x: (n.generation - base) * COL, y });
    return y;
  };
  for (const r of roots) place(r);
  const depth = Math.max(1, ...nodes.map((n) => n.generation - base + 1));
  const width = depth * COL + PAD * 2;
  const height = Math.max(1, row) * ROW + PAD * 2;

  return (
    <div className="admin-card overflow-auto p-0" data-testid="network-graph">
      <svg
        role="group"
        aria-label={label}
        width={width}
        height={height}
        viewBox={`${String(-PAD)} ${String(-PAD - ROW / 2 + 12)} ${String(width)} ${String(height)}`}
        className="block"
      >
        {nodes.map((n) => {
          const from = n.inviterId ? pos.get(n.inviterId) : undefined;
          const to = pos.get(n.id);
          if (!from || !to) return null;
          const mx = (from.x + to.x) / 2;
          return (
            <path
              key={`e-${n.id}`}
              d={`M${String(from.x + 7)},${String(from.y)} C${String(mx)},${String(from.y)} ${String(mx)},${String(to.y)} ${String(to.x - 7)},${String(to.y)}`}
              fill="none"
              stroke="var(--tg-border)"
              strokeWidth={1.5}
            />
          );
        })}
        {nodes.map((n) => {
          const p = pos.get(n.id);
          if (!p) return null;
          const name = nameOf(n);
          return (
            <a
              key={n.id}
              href={`/admin/customers/${n.id}`}
              aria-label={`${name}, ${day.format(new Date(n.joinedAt))}`}
            >
              <circle
                cx={p.x}
                cy={p.y}
                r={7}
                fill={n.entry === 'team' ? 'var(--tg-primary)' : 'var(--tg-surface)'}
                stroke="var(--tg-primary)"
                strokeWidth={2}
              />
              <text x={p.x + 12} y={p.y - 1} fontSize={13} fontWeight={600} fill="var(--tg-text)">
                {name.length > 22 ? `${name.slice(0, 21)}…` : name}
                {n.direct > 0 ? ` (${String(n.descendants)})` : ''}
              </text>
              <text x={p.x + 12} y={p.y + 13} fontSize={11} fill="var(--tg-text-muted)">
                {day.format(new Date(n.joinedAt))}
              </text>
            </a>
          );
        })}
      </svg>
    </div>
  );
}
