'use client';

import { resources } from '@touchgrass/shared';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';

const t = resources.en.admin.shell;
const errors = resources.en.errors as Record<string, string>;

/** The answer to the last form sent on this page (D-186): saved, or why not. */
export function AdminNotice() {
  const sp = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const failed = sp.get('failed');
  const detail = sp.get('detail');
  const saved = sp.get('saved') === '1';
  if (!failed && !saved) return null;
  const dismiss = (): void => {
    const next = new URLSearchParams(sp.toString());
    for (const p of ['failed', 'detail', 'saved']) next.delete(p);
    const qs = next.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname);
  };
  return (
    <div
      role={failed ? 'alert' : 'status'}
      data-testid={failed ? 'admin-failed' : 'admin-saved'}
      className={`admin-card flex items-start justify-between gap-3 ${
        failed ? 'border-[color:var(--tg-danger)]' : 'border-primary'
      }`}
    >
      <div className="flex flex-col gap-1">
        <strong>{failed ? t.failed : t.saved}</strong>
        {failed ? (
          <span className="text-sm">
            {detail ?? errors[failed] ?? failed}
            {detail && errors[failed] && errors[failed] !== detail ? ` (${errors[failed]})` : ''}
          </span>
        ) : null}
      </div>
      <button
        type="button"
        onClick={dismiss}
        className="min-h-11 rounded-lg px-3 text-sm font-semibold underline"
      >
        {t.dismiss}
      </button>
    </div>
  );
}
