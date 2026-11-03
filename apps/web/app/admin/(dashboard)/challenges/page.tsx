import { AdminBadgeList, AdminChallengeList, InterestList, resources } from '@touchgrass/shared';
import { adminApi } from '../../../../lib/admin-session';
import { toggleChallengeAction } from './actions';
import { ChallengeForm } from './challenge-form';
import { canOpen } from '../../../../lib/admin-nav';
import { NoAccess } from '../../../../lib/admin-ui';

const t = resources.en.admin;
const th = 'p-2 text-left';
const fmt = new Intl.DateTimeFormat('en-IN', {
  dateStyle: 'medium',
  timeStyle: 'short',
  timeZone: 'Asia/Kolkata',
});

/** Themed challenges (F-GAM-03, F-WEB-03): create, see who joined and finished, turn on or off. */
export default async function ChallengesPage() {
  if (!(await canOpen('challenges'))) return <NoAccess />;
  const [list, badges, interests] = await Promise.all([
    adminApi('/v1/admin/challenges', AdminChallengeList, {}, '/admin/challenges'),
    adminApi('/v1/admin/badges', AdminBadgeList, {}, '/admin/challenges'),
    adminApi('/v1/interests', InterestList, {}, '/admin/challenges'),
  ]);
  return (
    <>
      <h1 className="text-3xl font-extrabold">{t.challenges}</h1>
      <ChallengeForm
        interests={interests.items.map((i) => ({ id: i.id, name: `${i.emoji} ${i.name.en}` }))}
        badges={badges.items
          .filter((b) => b.active)
          .map((b) => ({ id: b.id, name: `${b.emoji} ${b.name.en}` }))}
      />
      {list.items.length === 0 ? (
        <p>{t.empty}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left" data-testid="challenges-table">
            <thead>
              <tr className="border-b-2 border-border">
                <th scope="col" className={th}>
                  {t.titleEn}
                </th>
                <th scope="col" className={th}>
                  {t.mode}
                </th>
                <th scope="col" className={th}>
                  {t.startsAt}
                </th>
                <th scope="col" className={th}>
                  {t.endsAt}
                </th>
                <th scope="col" className={th}>
                  {t.target}
                </th>
                <th scope="col" className={th}>
                  {t.participants}
                </th>
                <th scope="col" className={th}>
                  {t.completedCol}
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
              {list.items.map((c) => (
                <tr key={c.id} className="border-b border-border">
                  <td className="p-2">
                    <span aria-hidden="true">{c.emoji}</span> {c.title.en}
                  </td>
                  <td className="p-2">{c.mode === 'solo' ? t.modeSolo : t.modeGroup}</td>
                  <td className="p-2 whitespace-nowrap">{fmt.format(new Date(c.startsAt))}</td>
                  <td className="p-2 whitespace-nowrap">{fmt.format(new Date(c.endsAt))}</td>
                  <td className="p-2">{c.criteria.target}</td>
                  <td className="p-2">{c.participants}</td>
                  <td className="p-2">{c.completed}</td>
                  <td className="p-2">{c.active ? t.enabled : t.disabled}</td>
                  <td className="p-2">
                    <form action={toggleChallengeAction}>
                      <input type="hidden" name="id" value={c.id} />
                      <input type="hidden" name="active" value={c.active ? 'false' : 'true'} />
                      <button
                        type="submit"
                        className="min-h-11 rounded-full border-2 border-border px-4 font-semibold"
                        aria-label={`${c.active ? t.deactivate : t.activate} ${c.title.en}`}
                      >
                        {c.active ? t.deactivate : t.activate}
                      </button>
                    </form>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
