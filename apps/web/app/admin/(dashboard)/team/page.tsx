import { AdminCityList, AdminRole, resources, TeamList } from '@touchgrass/shared';
import { canOpen } from '../../../../lib/admin-nav';
import { adminApi } from '../../../../lib/admin-session';
import {
  inputClass,
  istDateTime,
  labelClass,
  NoAccess,
  primaryButton,
  secondaryButton,
} from '../../../../lib/admin-ui';
import { grantRoleAction, revokeRoleAction } from './actions';

const c = resources.en.admin.console;

export default async function TeamPage() {
  if (!(await canOpen('team'))) return <NoAccess />;
  const [team, cities] = await Promise.all([
    adminApi('/v1/admin/team', TeamList, {}, '/admin/team'),
    adminApi('/v1/admin/cities', AdminCityList, {}, '/admin/team'),
  ]);
  return (
    <>
      <h1 className="text-3xl font-extrabold">{c.team}</h1>
      <div className="overflow-x-auto">
        <table className="w-full text-left">
          <thead>
            <tr>
              {[c.member, c.role, c.city, c.since, ''].map((h, i) => (
                <th key={h || i} scope="col" className="p-2">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {team.items.map((r) => {
              const name = r.displayName ?? r.userId;
              return (
                <tr key={r.id} className="border-t-2 border-border" data-testid={`team-${r.id}`}>
                  <td className="p-2">{name}</td>
                  <td className="p-2">{c.roleNames[r.role]}</td>
                  <td className="p-2">{r.cityName ?? '—'}</td>
                  <td className="p-2">{istDateTime.format(new Date(r.createdAt))}</td>
                  <td className="p-2">
                    <form action={revokeRoleAction}>
                      <input type="hidden" name="id" value={r.id} />
                      <button type="submit" className={secondaryButton}>
                        {c.revokeRole
                          .replace('{{role}}', c.roleNames[r.role])
                          .replace('{{name}}', name)}
                      </button>
                    </form>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <section aria-labelledby="grant" className="flex flex-col gap-3">
        <h2 id="grant" className="text-xl font-bold">
          {c.grant}
        </h2>
        <form
          action={grantRoleAction}
          className="flex flex-wrap items-end gap-3"
          aria-labelledby="grant"
        >
          <label className={labelClass} htmlFor="userId">
            {c.userId}
            <input id="userId" name="userId" required className={inputClass} />
          </label>
          <label className={labelClass} htmlFor="role">
            {c.role}
            <select id="role" name="role" className={inputClass}>
              {AdminRole.options.map((r) => (
                <option key={r} value={r}>
                  {c.roleNames[r]}
                </option>
              ))}
            </select>
          </label>
          <label className={labelClass} htmlFor="cityId">
            {c.forCity}
            <select id="cityId" name="cityId" defaultValue="" className={inputClass}>
              <option value="">—</option>
              {cities.items.map((city) => (
                <option key={city.id} value={city.id}>
                  {city.name}
                </option>
              ))}
            </select>
          </label>
          <button type="submit" className={primaryButton}>
            {c.grant}
          </button>
        </form>
      </section>
    </>
  );
}
