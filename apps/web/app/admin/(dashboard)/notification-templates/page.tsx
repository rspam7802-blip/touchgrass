import { AdminNotificationTemplateList, resources, SUPPORTED_LANGUAGES } from '@touchgrass/shared';
import { canOpen } from '../../../../lib/admin-nav';
import { adminApi } from '../../../../lib/admin-session';
import {
  inputClass,
  labelClass,
  NoAccess,
  primaryButton,
  secondaryButton,
} from '../../../../lib/admin-ui';
import { resetTemplateAction, saveTemplateAction } from './actions';

const c = resources.en.admin.console;
const LANG_NAMES = { en: 'English', te: 'తెలుగు', hi: 'हिन्दी' } as const;

export default async function TemplatesPage() {
  if (!(await canOpen('notificationTemplates'))) return <NoAccess />;
  const data = await adminApi(
    '/v1/admin/notification-templates',
    AdminNotificationTemplateList,
    {},
    '/admin/notification-templates',
  );
  return (
    <>
      <h1 className="text-3xl font-extrabold">{c.templates}</h1>
      <p>{c.templatesNote.replace('{{placeholders}}', '{{…}}')}</p>
      <ul className="flex flex-col gap-3">
        {data.items.map((tpl) => (
          <li
            key={tpl.kind}
            className="rounded-2xl border-2 border-border bg-surface p-4"
            data-testid={`template-${tpl.kind}`}
          >
            <details>
              <summary className="min-h-11 cursor-pointer py-2">
                <span className="font-semibold">{tpl.defaults.en.title}</span> · {tpl.kind} ·{' '}
                {tpl.category}
                {tpl.urgent ? ` · ${c.urgentFlag}` : ''}
                {tpl.batch ? ` · ${c.batchFlag}` : ''}
                {tpl.inbox ? ` · ${c.inboxFlag}` : ''}
              </summary>
              <p className="text-sm">
                {c.placeholders.replace(
                  '{{list}}',
                  tpl.placeholders.length
                    ? tpl.placeholders.map((p) => `{{${p}}}`).join(', ')
                    : c.none,
                )}
              </p>
              {SUPPORTED_LANGUAGES.map((lang) => {
                const custom = tpl.overrides[lang];
                const id = `${tpl.kind}-${lang}`;
                return (
                  <div key={lang} className="mt-3 flex flex-col gap-2" lang={lang}>
                    <h3 className="font-semibold">{LANG_NAMES[lang]}</h3>
                    <p className="text-sm">
                      {c.defaultCopy}: {tpl.defaults[lang].title} — {tpl.defaults[lang].body}
                    </p>
                    <form
                      action={saveTemplateAction}
                      className="flex flex-col gap-2"
                      aria-label={`${c.override}: ${tpl.kind} ${LANG_NAMES[lang]}`}
                    >
                      <input type="hidden" name="kind" value={tpl.kind} />
                      <input type="hidden" name="lang" value={lang} />
                      <label className={labelClass} htmlFor={`${id}-title`}>
                        {c.titleField}
                        <input
                          id={`${id}-title`}
                          name="title"
                          required
                          maxLength={120}
                          defaultValue={custom?.title ?? tpl.defaults[lang].title}
                          className={inputClass}
                        />
                      </label>
                      <label className={labelClass} htmlFor={`${id}-body`}>
                        {c.bodyField}
                        <input
                          id={`${id}-body`}
                          name="body"
                          required
                          maxLength={300}
                          defaultValue={custom?.body ?? tpl.defaults[lang].body}
                          className={inputClass}
                        />
                      </label>
                      <button type="submit" className={`${primaryButton} self-start`}>
                        {resources.en.admin.save}
                      </button>
                    </form>
                    {custom ? (
                      <form action={resetTemplateAction}>
                        <input type="hidden" name="kind" value={tpl.kind} />
                        <input type="hidden" name="lang" value={lang} />
                        <button type="submit" className={secondaryButton}>
                          {c.useDefault}
                        </button>
                      </form>
                    ) : null}
                  </div>
                );
              })}
            </details>
          </li>
        ))}
      </ul>
    </>
  );
}
