import { IcebreakerDeck, resources } from '@touchgrass/shared';
import { adminApi } from '../../../../lib/admin-session';
import { toggleAction } from './actions';
import { CardForm } from './card-form';
import { canOpen } from '../../../../lib/admin-nav';
import { NoAccess } from '../../../../lib/admin-ui';

const t = resources.en.admin;

/** Icebreaker deck (F-ATE-01) for admins and city curators: add prompts in all three languages, turn cards on/off. */
export default async function IcebreakersPage() {
  if (!(await canOpen('icebreakers'))) return <NoAccess />;
  const deck = await adminApi('/v1/admin/icebreakers', IcebreakerDeck, {}, '/admin/icebreakers');
  return (
    <>
      <h1 className="text-3xl font-extrabold">{t.icebreakers}</h1>
      <p className="text-muted">{t.icebreakersNote}</p>
      <CardForm />
      {deck.items.length === 0 ? (
        <p>{t.empty}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead>
              <tr className="border-b-2 border-border">
                <th scope="col" className="p-2">
                  {t.promptEn}
                </th>
                <th scope="col" className="p-2">
                  {t.promptTe}
                </th>
                <th scope="col" className="p-2">
                  {t.promptHi}
                </th>
                <th scope="col" className="p-2">
                  {t.icebreakerCategory}
                </th>
                <th scope="col" className="p-2">
                  {t.status}
                </th>
                <th scope="col" className="p-2">
                  <span className="sr-only">{t.action}</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {deck.items.map((c) => (
                <tr
                  key={c.id}
                  className="border-b border-border"
                  data-testid={`icebreaker-${c.id}`}
                >
                  <td className="p-2" lang="en">
                    {c.prompt.en}
                  </td>
                  <td className="p-2" lang="te">
                    {c.prompt.te}
                  </td>
                  <td className="p-2" lang="hi">
                    {c.prompt.hi}
                  </td>
                  <td className="p-2">{t.icebreakerCategories[c.category]}</td>
                  <td className="p-2">{c.active ? t.enabled : t.disabled}</td>
                  <td className="p-2">
                    <form action={toggleAction}>
                      <input type="hidden" name="id" value={c.id} />
                      <input type="hidden" name="active" value={c.active ? 'false' : 'true'} />
                      <button
                        type="submit"
                        className="min-h-11 rounded-full border-2 border-border px-4 font-semibold"
                        aria-label={`${c.active ? t.deactivate : t.activate}: ${c.prompt.en}`}
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
