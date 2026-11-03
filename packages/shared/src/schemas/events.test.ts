import { describe, expect, it } from 'vitest';
import { CreateEventBody, PublicEventView, RsvpBody, UpdateEventBody } from './events';

const base = {
  title: 'Sunset frisbee',
  categoryInterestId: '0192f3a4-5b6c-7d8e-9f01-23456789abcd',
  where: { point: { lat: 17.44, lng: 78.35 }, address: 'Lake Road' },
  startsAt: '2026-11-03T12:30:00.000Z',
  endsAt: '2026-11-03T14:30:00.000Z',
  capacity: 8,
};

describe('event schemas (F-EVT-01/16)', () => {
  it('fills create-time defaults', () => {
    expect(CreateEventBody.parse(base)).toMatchObject({
      type: 'plan',
      visibility: 'public',
      mystery: false,
      mysteryRevealMinutesBefore: 120,
      publish: true,
      where: { placeName: null },
    });
  });

  it('edits never fill defaults, so omitted fields are left alone', () => {
    expect(UpdateEventBody.parse({ title: 'New title' })).toEqual({ title: 'New title' });
    expect(UpdateEventBody.safeParse({}).success).toBe(false);
  });

  it('enforces cross-field rules on both', () => {
    expect(CreateEventBody.safeParse({ ...base, endsAt: base.startsAt }).success).toBe(false);
    expect(CreateEventBody.safeParse({ ...base, endsAt: '2026-11-07T12:30:00.000Z' }).success).toBe(
      false,
    );
    expect(CreateEventBody.safeParse({ ...base, smallGroup: true, capacity: 12 }).success).toBe(
      false,
    );
    expect(CreateEventBody.safeParse({ ...base, visibility: 'balanced' }).success).toBe(false);
    expect(CreateEventBody.safeParse({ ...base, minGroupSize: 9 }).success).toBe(false);
    expect(UpdateEventBody.safeParse({ smallGroup: true, capacity: 20 }).success).toBe(false);
  });

  it('+1 and public views', () => {
    expect(RsvpBody.parse({ status: 'going' })).toEqual({ status: 'going', plusOne: null });
    expect(RsvpBody.safeParse({ status: 'going', plusOne: { guest: false } }).success).toBe(false);
    expect(
      PublicEventView.safeParse({
        access: 'teaser',
        slug: 'AbCd2345',
        hostName: 'R',
        startsAt: base.startsAt,
        status: 'published',
      }).success,
    ).toBe(true);
  });
});
