'use server';

import { SUPPORTED_LANGUAGES, TemplateOverrideBody } from '@touchgrass/shared';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { adminApi } from '../../../../lib/admin-session';

const PATH = '/admin/notification-templates';
const Kind = z.string().regex(/^[a-z_]+$/);
const Lang = z.enum(SUPPORTED_LANGUAGES);

export async function saveTemplateAction(form: FormData): Promise<void> {
  const kind = Kind.parse(form.get('kind'));
  const lang = Lang.parse(form.get('lang'));
  const body = TemplateOverrideBody.parse({ title: form.get('title'), body: form.get('body') });
  await adminApi(
    `/v1/admin/notification-templates/${kind}/${lang}`,
    z.object({ ok: z.literal(true) }),
    { method: 'PUT', body: JSON.stringify(body) },
    PATH,
  );
  revalidatePath(PATH);
}

export async function resetTemplateAction(form: FormData): Promise<void> {
  const kind = Kind.parse(form.get('kind'));
  const lang = Lang.parse(form.get('lang'));
  await adminApi(
    `/v1/admin/notification-templates/${kind}/${lang}`,
    z.undefined(),
    { method: 'DELETE' },
    PATH,
  );
  revalidatePath(PATH);
}
