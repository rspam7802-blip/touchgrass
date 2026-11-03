import { type AdminBadge, AdminBadgeList, resources } from '@touchgrass/shared';
import { adminApi } from '../../../../lib/admin-session';
import { toggleBadgeAction } from './actions';
import { BadgeForm } from './badge-form';
import { canOpen } from '../../../../lib/admin-nav';
import { NoAccess } from '../../../../lib/admin-ui';

const t = resources.en.admin;
const th = 'p-2 text-left';

function ruleText(b: AdminBadge): string {
  const r = b.rule;
  const fact = t.facts[r.fact];
  if (r.type === 'count')
    return `${t.ruleCount}: ${fact}${r.onTimeOnly ? ` (${t.onTimeOnly})` : ''} ≥ ${String(r.threshold)}`;
  const kind = r.type === 'distinct' ? t.ruleDistinct : t.ruleGroup;
  return `${kind}: ${fact} · ${t.fields[r.field]} ≥ ${String(r.threshold)}`;
}

/** Badges (F-GAM-01, F-WEB-03): add rule badges without code; turn any badge on or off. */
export default async function BadgesPage() {
  if (!(await canOpen('badges'))) return <NoAccess />;
  const list = await adminApi('/v1/admin/badges', AdminBadgeList, {}, '/admin/badges');
  return (
    <>
      <h1 className="text-3xl font-extrabold">{t.badges}</h1>
      <BadgeForm />
      <div className="overflow-x-auto">
        <table className="w-full text-left" data-testid="badges-table">
          <thead>
            <tr className="border-b-2 border-border">
              <th scope="col" className={th}>
                {t.nameEn}
              </th>
              <th scope="col" className={th}>
                {t.rule}
              </th>
              <th scope="col" className={th}>
                {t.earned}
              </th>
              <th scope="col" className={th}>
                {t.status}
              </th>
              <th scope="col" className={th}>
                <span className="sr-only">{t.action}</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {list.items.map((b) => (
              <tr key={b.id} className="border-b border-border" data-testid={`badge-${b.key}`}>
                <td className="p-2">
                  <span aria-hidden="true">{b.emoji}</span> {b.name.en}
                  {b.builtin ? <span className="text-sm text-muted"> · {t.builtin}</span> : null}
                </td>
                <td className="p-2">{ruleText(b)}</td>
                <td className="p-2">{b.earnedCount}</td>
                <td className="p-2">{b.active ? t.enabled : t.disabled}</td>
                <td className="p-2">
                  <form action={toggleBadgeAction}>
                    <input type="hidden" name="id" value={b.id} />
                    <input type="hidden" name="active" value={b.active ? 'false' : 'true'} />
                    <button
                      type="submit"
                      className="min-h-11 rounded-full border-2 border-border px-4 font-semibold"
                      aria-label={`${b.active ? t.deactivate : t.activate} ${b.name.en}`}
                    >
                      {b.active ? t.deactivate : t.activate}
                    </button>
                  </form>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
