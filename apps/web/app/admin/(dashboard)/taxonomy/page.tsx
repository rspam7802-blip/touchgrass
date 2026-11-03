import { type AdminTaxonomyItem, AdminTaxonomy, resources } from '@touchgrass/shared';
import { canOpen } from '../../../../lib/admin-nav';
import { adminApi } from '../../../../lib/admin-session';
import { inputClass, labelClass, NoAccess, primaryButton } from '../../../../lib/admin-ui';
import { saveTaxonomyAction } from './actions';

const t = resources.en.admin;
const c = t.console;

function ItemForm({
  kind,
  item,
  prefix,
}: {
  kind: 'interests' | 'vibe-tags';
  item: AdminTaxonomyItem | null;
  prefix: string;
}) {
  const input = (
    name: string,
    label: string,
    value: string | number,
    lang?: string,
    type = 'text',
  ) => (
    <label className={labelClass} htmlFor={`${prefix}-${name}`}>
      {label}
      <input
        id={`${prefix}-${name}`}
        name={name}
        type={type}
        lang={lang}
        required={name !== 'sortOrder'}
        defaultValue={value}
        className={inputClass}
      />
    </label>
  );
  return (
    <form
      action={saveTaxonomyAction}
      className="grid gap-3 sm:grid-cols-3"
      aria-label={
        item
          ? `${t.save}: ${item.name.en}`
          : `${c.add}: ${kind === 'interests' ? c.interests : c.vibeTags}`
      }
    >
      <input type="hidden" name="kind" value={kind} />
      <input type="hidden" name="id" value={item?.id ?? ''} />
      {input('nameEn', c.nameEn, item?.name.en ?? '', 'en')}
      {input('nameTe', c.nameTe, item?.name.te ?? '', 'te')}
      {input('nameHi', c.nameHi, item?.name.hi ?? '', 'hi')}
      {input('slug', c.slug, item?.slug ?? '')}
      {input('emoji', c.emoji, item?.emoji ?? '')}
      {kind === 'interests' ? input('category', c.interestCategory, item?.category ?? '') : null}
      {input('sortOrder', c.sortOrder, item?.sortOrder ?? 0, undefined, 'number')}
      <label className="flex min-h-11 items-center gap-2 font-semibold">
        <input
          type="checkbox"
          name="active"
          defaultChecked={item?.active ?? true}
          className="size-5"
        />
        {c.activeLabel}
      </label>
      <button type="submit" className={`${primaryButton} sm:justify-self-start`}>
        {item ? t.save : c.add}
      </button>
    </form>
  );
}

function Section({
  kind,
  title,
  items,
}: {
  kind: 'interests' | 'vibe-tags';
  title: string;
  items: AdminTaxonomyItem[];
}) {
  return (
    <section aria-labelledby={kind} className="flex flex-col gap-3">
      <h2 id={kind} className="text-xl font-bold">
        {title}
      </h2>
      <ul className="flex flex-col gap-2">
        {items.map((i) => (
          <li
            key={i.id}
            className="rounded-2xl border-2 border-border bg-surface p-3"
            data-testid={`taxonomy-${i.slug}`}
          >
            <details>
              <summary className="min-h-11 cursor-pointer py-2">
                <span className="font-semibold">
                  {i.emoji} {i.name.en}
                </span>{' '}
                · <span lang="te">{i.name.te}</span> · <span lang="hi">{i.name.hi}</span> ·{' '}
                {c.usage.replace('{{count}}', String(i.usage))}
                {i.active ? '' : ` · ${t.disabled}`}
              </summary>
              <ItemForm kind={kind} item={i} prefix={i.id} />
            </details>
          </li>
        ))}
      </ul>
      <ItemForm kind={kind} item={null} prefix={`new-${kind}`} />
    </section>
  );
}

export default async function TaxonomyPage() {
  if (!(await canOpen('taxonomy'))) return <NoAccess />;
  const data = await adminApi('/v1/admin/taxonomy', AdminTaxonomy, {}, '/admin/taxonomy');
  return (
    <>
      <h1 className="text-3xl font-extrabold">{c.taxonomy}</h1>
      <Section kind="vibe-tags" title={c.vibeTags} items={data.vibeTags} />
      <Section kind="interests" title={c.interests} items={data.interests} />
    </>
  );
}
