import { RANKING_WEIGHT_KEYS, RankingWeights, resources } from '@touchgrass/shared';
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
import { resetWeightsAction, saveWeightsAction } from './actions';

const c = resources.en.admin.console;

export default async function WeightsPage() {
  if (!(await canOpen('weights'))) return <NoAccess />;
  const data = await adminApi('/v1/admin/weights', RankingWeights, {}, '/admin/weights');
  return (
    <>
      <h1 className="text-3xl font-extrabold">{c.weights}</h1>
      <p>{c.weightsNote}</p>
      {data.updatedAt ? (
        <p className="text-muted">{istDateTime.format(new Date(data.updatedAt))}</p>
      ) : null}
      <form action={saveWeightsAction} className="grid gap-3 sm:grid-cols-2" aria-label={c.weights}>
        {RANKING_WEIGHT_KEYS.map((k) => (
          <label key={k} className={labelClass} htmlFor={`w-${k}`}>
            {c.weightNames[k]}
            <input
              id={`w-${k}`}
              name={k}
              type="number"
              min={0}
              max={10}
              step={0.25}
              required
              defaultValue={data.weights[k]}
              aria-describedby={`w-${k}-default`}
              className={inputClass}
            />
            <span id={`w-${k}-default`} className="text-sm font-normal text-muted">
              {c.defaultValue.replace('{{value}}', String(data.defaults[k]))}
            </span>
          </label>
        ))}
        <button type="submit" className={`${primaryButton} sm:col-span-2 sm:justify-self-start`}>
          {resources.en.admin.save}
        </button>
      </form>
      <form action={resetWeightsAction}>
        <button type="submit" className={secondaryButton}>
          {c.resetDefaults}
        </button>
      </form>
    </>
  );
}
