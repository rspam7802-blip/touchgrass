import 'server-only';
import { headers } from 'next/headers';
import { redirect, unstable_rethrow } from 'next/navigation';
import { ZodError } from 'zod';
import { AdminApiError } from './admin-session';

const NOTICE_PARAMS = ['failed', 'detail', 'saved'];

/** The admin page the form was sent from (same site only), without an earlier notice. */
async function backTo(): Promise<string> {
  const h = await headers();
  const referer = h.get('referer');
  const host = h.get('x-forwarded-host') ?? h.get('host');
  try {
    if (!referer) return '/admin';
    const url = new URL(referer);
    if (host && url.host !== host) return '/admin';
    if (!url.pathname.startsWith('/admin')) return '/admin';
    for (const p of NOTICE_PARAMS) url.searchParams.delete(p);
    const qs = url.searchParams.toString();
    return qs ? `${url.pathname}?${qs}` : url.pathname;
  } catch {
    return '/admin';
  }
}

function withParams(path: string, params: Record<string, string>): string {
  const [base, qs] = path.split('?');
  const sp = new URLSearchParams(qs);
  for (const [k, v] of Object.entries(params)) sp.set(k, v);
  return `${base ?? '/admin'}?${sp.toString()}`;
}

/**
 * Runs an admin form's work and always comes back to the page with an answer (D-186): "Saved" when it worked,
 * or the API's reason when it didn't, instead of an error page. Redirects the work itself makes (e.g. to a
 * new plan) still happen.
 */
export async function guarded(work: () => Promise<void>): Promise<never> {
  const back = await backTo();
  try {
    await work();
  } catch (err) {
    unstable_rethrow(err);
    if (err instanceof AdminApiError)
      redirect(withParams(back, { failed: err.code, detail: err.message.slice(0, 300) }));
    if (err instanceof ZodError)
      redirect(
        withParams(back, {
          failed: 'VALIDATION_FAILED',
          detail: err.issues
            .map((i) => `${i.path.join('.') || 'form'}: ${i.message}`)
            .join('; ')
            .slice(0, 300),
        }),
      );
    throw err;
  }
  redirect(withParams(back, { saved: '1' }));
}
