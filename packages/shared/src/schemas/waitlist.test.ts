import { describe, expect, it } from 'vitest';
import { canAccessSection } from './admin-console';
import { LaunchWaitlistBody, waitlistCitySlug } from './waitlist';

const base = { name: 'Asha', consent: true };

describe('launch waitlist body (D-169)', () => {
  it('normalises the phone, email and city', () => {
    const parsed = LaunchWaitlistBody.parse({
      ...base,
      phone: '98480 22338',
      email: ' Asha@Example.COM ',
      city: '  Navi Mumbai ',
      note: '  Board games  ',
    });
    expect(parsed).toMatchObject({
      phone: '+919848022338',
      email: 'asha@example.com',
      city: 'navi-mumbai',
      note: 'Board games',
      language: 'en',
    });
  });

  it('defaults the city to Hyderabad and treats empty fields as missing', () => {
    const parsed = LaunchWaitlistBody.parse({ ...base, email: 'a@b.co', phone: '', note: '' });
    expect(parsed).toMatchObject({ phone: null, city: 'hyderabad', note: null });
    expect(LaunchWaitlistBody.parse({ ...base, email: 'a@b.co', city: '' }).city).toBe('hyderabad');
  });

  it('needs a contact, consent, a name and an Indian number', () => {
    expect(LaunchWaitlistBody.safeParse(base).success).toBe(false);
    expect(LaunchWaitlistBody.safeParse({ ...base, email: '', phone: '' }).success).toBe(false);
    expect(LaunchWaitlistBody.safeParse({ ...base, email: 'a@b.co', consent: false }).success).toBe(
      false,
    );
    expect(LaunchWaitlistBody.safeParse({ name: 'Asha', email: 'a@b.co' }).success).toBe(false);
    expect(LaunchWaitlistBody.safeParse({ ...base, name: ' ', email: 'a@b.co' }).success).toBe(
      false,
    );
    expect(LaunchWaitlistBody.safeParse({ ...base, phone: '+14155552671' }).success).toBe(false);
    expect(LaunchWaitlistBody.safeParse({ ...base, phone: '12345' }).success).toBe(false);
    expect(LaunchWaitlistBody.safeParse({ ...base, email: 'not-an-email' }).success).toBe(false);
    expect(
      LaunchWaitlistBody.safeParse({ ...base, email: 'a@b.co', note: 'x'.repeat(201) }).success,
    ).toBe(false);
    expect(
      LaunchWaitlistBody.safeParse({ ...base, email: 'a@b.co', name: 'x'.repeat(61) }).success,
    ).toBe(false);
  });

  it('keeps letters of every script in city slugs', () => {
    expect(waitlistCitySlug('Hyderabad')).toBe('hyderabad');
    expect(waitlistCitySlug('హైదరాబాద్')).toBe('హైదరాబాద్');
    expect(waitlistCitySlug('--!!--')).toBe('');
  });

  it('lets admins and support open the waitlist, nobody else', () => {
    expect(canAccessSection(['admin'], 'waitlist')).toBe(true);
    expect(canAccessSection(['support'], 'waitlist')).toBe(true);
    expect(canAccessSection(['city_curator'], 'waitlist')).toBe(false);
    expect(canAccessSection(['support'], 'inviteCodes')).toBe(false);
  });
});
