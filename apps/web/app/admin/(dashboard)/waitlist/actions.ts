'use server';

import { LaunchWaitlistInviteResult } from '@touchgrass/shared';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { AdminApiError, adminApi } from '../../../../lib/admin-session';

const PATH = '/admin/waitlist';

export interface InviteState {
  code: string | null;
  /** The address it was emailed to, if it was. */
  emailedTo: string | null;
  error: string | null;
}

/**
 * Invites one entry (D-169). The list is not refreshed here: the row keeps showing the new code so the admin
 * can copy it; the next visit lists the entry as invited.
 */
export async function inviteAction(_prev: InviteState, form: FormData): Promise<InviteState> {
  const id = z.uuid().parse(form.get('id'));
  try {
    const res = await adminApi(
      `/v1/admin/waitlist/${id}/invite`,
      LaunchWaitlistInviteResult,
      { method: 'POST' },
      PATH,
    );
    return {
      code: res.code,
      emailedTo: res.emailed ? res.entry.email : null,
      error: null,
    };
  } catch (err) {
    if (err instanceof AdminApiError) return { code: null, emailedTo: null, error: err.message };
    throw err;
  }
}

/** Data-deletion requests: deletes the entry for good (audited by the API). */
export async function removeAction(form: FormData): Promise<void> {
  const id = z.uuid().parse(form.get('id'));
  await adminApi(`/v1/admin/waitlist/${id}`, z.undefined(), { method: 'DELETE' }, PATH);
  revalidatePath(PATH);
}
