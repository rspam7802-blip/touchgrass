import { describe, expect, it } from 'vitest';
import { waitlistInviteEmail } from './waitlist-email.js';
import { planWaitlistWrite } from './waitlist.service.js';

const row = (id: string, phoneE164: string | null, email: string | null) => ({
  id,
  phoneE164,
  email,
});

describe('waitlist write plan (D-169)', () => {
  const input = { phone: '+919848022338', email: 'asha@example.com' };

  it('inserts a contact nobody holds', () => {
    expect(planWaitlistWrite(input, null, null)).toEqual({ kind: 'insert' });
  });

  it('updates the phone match and fills in a free email', () => {
    expect(planWaitlistWrite(input, row('a', input.phone, null), null)).toEqual({
      kind: 'update',
      id: 'a',
      setPhone: false,
      setEmail: true,
    });
  });

  it('updates the email match and fills in a free phone', () => {
    expect(planWaitlistWrite(input, null, row('b', null, input.email))).toEqual({
      kind: 'update',
      id: 'b',
      setPhone: true,
      setEmail: false,
    });
  });

  it('never replaces a contact or takes one from another entry', () => {
    // The email row already has another phone: keep it.
    expect(planWaitlistWrite(input, null, row('b', '+919000000000', input.email))).toMatchObject({
      setPhone: false,
    });
    // Phone and email belong to two different entries: update the phone's, leave the email where it is.
    expect(
      planWaitlistWrite(input, row('a', input.phone, null), row('b', null, input.email)),
    ).toEqual({ kind: 'update', id: 'a', setPhone: false, setEmail: false });
    // Nothing to fill in when the submission has no email.
    expect(
      planWaitlistWrite({ phone: input.phone, email: null }, row('a', input.phone, null), null),
    ).toMatchObject({ setEmail: false });
  });
});

describe('waitlist invite email', () => {
  it('is in the visitor’s language, carries the code and escapes their name', () => {
    const mail = waitlistInviteEmail({
      to: 'asha@example.com',
      name: '<Asha>',
      code: 'ABCD-EFGH',
      validDays: 30,
      siteUrl: 'https://touchgrass.co.in',
      language: 'hi',
    });
    expect(mail.subject).toMatch(/[ऀ-ॿ]/);
    expect(mail.text).toContain('ABCD-EFGH');
    expect(mail.text).toContain('30');
    expect(mail.text).toContain('https://touchgrass.co.in');
    expect(mail.html).toContain('&lt;Asha&gt;');
    expect(mail.html).not.toContain('<Asha>');
    expect(mail.html).toContain('lang="hi"');
  });
});
