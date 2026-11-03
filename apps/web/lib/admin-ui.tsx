import { resources } from '@touchgrass/shared';

/** Shared admin form styling, so every section reads the same (44 px targets, visible borders). */
export const inputClass = 'min-h-11 rounded-xl border-2 border-input bg-surface px-3 text-text';
export const primaryButton = 'min-h-11 rounded-full bg-primary px-6 font-bold text-on-primary';
export const secondaryButton =
  'min-h-11 rounded-full border-2 border-border px-5 font-semibold text-text hover:bg-surface-alt';
export const labelClass = 'flex flex-col gap-1 font-semibold';

export function NoAccess() {
  return (
    <p role="alert" className="rounded-2xl border-2 border-border bg-surface p-5">
      {resources.en.admin.console.noAccess}
    </p>
  );
}

export const istDateTime = new Intl.DateTimeFormat('en-IN', {
  dateStyle: 'medium',
  timeStyle: 'short',
  timeZone: 'Asia/Kolkata',
});
