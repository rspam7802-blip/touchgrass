import { describe, expect, it } from 'vitest';
import {
  AddProposalOptionBody,
  CreateProposalBody,
  CrewRecurrenceBody,
  SetAvailabilityBody,
  UpdateCrewBody,
} from './engagement';

describe('engagement request schemas (F-ENG-01..03)', () => {
  it('free-now hours stay within 1–6', () => {
    expect(SetAvailabilityBody.parse({ hours: 3 })).toEqual({ hours: 3, note: '' });
    expect(SetAvailabilityBody.safeParse({ hours: 7 }).success).toBe(false);
    expect(SetAvailabilityBody.safeParse({ hours: 0 }).success).toBe(false);
  });

  it('crew updates need something to change; schedules need a supported rule', () => {
    expect(UpdateCrewBody.safeParse({}).success).toBe(false);
    expect(UpdateCrewBody.parse({ name: 'Sunday Run Club' })).toEqual({ name: 'Sunday Run Club' });
    const base = {
      rrule: 'FREQ=WEEKLY;BYDAY=SU',
      startsAt: '2026-11-08T00:30:00.000Z',
      durationMinutes: 90,
      where: { point: { lat: 17.42, lng: 78.42 }, address: 'KBR Park gate 1' },
      capacity: 20,
    };
    expect(CrewRecurrenceBody.parse(base)).toMatchObject({ title: '', active: true });
    expect(CrewRecurrenceBody.safeParse({ ...base, rrule: 'FREQ=YEARLY' }).success).toBe(false);
  });

  it('proposals take typed options', () => {
    expect(AddProposalOptionBody.parse({ kind: 'activity', label: 'Board games' })).toEqual({
      kind: 'activity',
      label: 'Board games',
      interestId: null,
    });
    expect(
      AddProposalOptionBody.safeParse({ kind: 'time', startsAt: 'soon', durationMinutes: 60 })
        .success,
    ).toBe(false);
    expect(
      CreateProposalBody.parse({
        title: 'Chai?',
        deadline: '2026-11-02T00:00:00.000Z',
        categoryInterestId: '0192f3a4-5b6c-7d8e-9f01-000000000001',
      }),
    ).toMatchObject({ autoLock: true, capacity: 10, inviteeIds: [], options: [] });
  });
});
