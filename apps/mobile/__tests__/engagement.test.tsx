import { act, fireEvent, screen, waitFor } from '@testing-library/react-native';
import type {
  BadgeView,
  EventDetail,
  ChallengeView,
  CrewDetail,
  CrewSummary,
  MyReferrals,
  PersonCard,
  ProposalDetail,
  Recap,
  StreakView,
} from '@touchgrass/shared';
import * as Sharing from 'expo-sharing';
import { Share } from 'react-native';
import { captureRef } from 'react-native-view-shot';
import BadgesScreen from '../app/(app)/badges';
import CheckoutScreen from '../app/(app)/events/[id]/checkout';
import EventScreen from '../app/(app)/events/[id]/index';
import ChallengesScreen from '../app/(app)/challenges';
import CrewScreen, { describeRule } from '../app/(app)/crews/[id]/index';
import CrewInviteScreen from '../app/(app)/crews/[id]/invite';
import CrewScheduleScreen from '../app/(app)/crews/[id]/schedule';
import CrewsScreen from '../app/(app)/crews/index';
import NewCrewScreen from '../app/(app)/crews/new';
import FreeScreen from '../app/(app)/free';
import ProposalScreen from '../app/(app)/proposals/[id]';
import ProposalsScreen from '../app/(app)/proposals/index';
import NewProposalScreen from '../app/(app)/proposals/new';
import RecapScreen from '../app/(app)/recaps/[id]';
import RecapsScreen from '../app/(app)/recaps/index';
import ReferralsScreen from '../app/(app)/referrals';
import { FreeNowStrip } from '../components/engagement/FreeNowStrip';
import { StreakCard } from '../components/engagement/StreakCard';
import { useAuthStore } from '../src/stores/auth-store';
import { authResponseFixture, FakeApi, ids, interestsFixture } from '../test/fake-api';
import { mockRouteParams, mockRouter, renderWithProviders, resetStores } from '../test-utils';

const CREW = '0192f3a4-5b6c-7d8e-9f01-0000000c0a01';
const PROP = '0192f3a4-5b6c-7d8e-9f01-0000000c0b01';
const EV1 = '0192f3a4-5b6c-7d8e-9f01-0000000c0c01';
const EV2 = '0192f3a4-5b6c-7d8e-9f01-0000000c0c02';
const VENUE = '0192f3a4-5b6c-7d8e-9f01-0000000c0d01';
const OPT = (n: number) => `0192f3a4-5b6c-7d8e-9f01-0000000c0e0${String(n)}`;
const P2 = '0192f3a4-5b6c-7d8e-9f01-000000000003';
const P3 = '0192f3a4-5b6c-7d8e-9f01-000000000004';

const person = (id: string, displayName: string): PersonCard => ({
  id,
  displayName,
  photo: null,
  verified: false,
  mutualFriendCount: 0,
});
const me = person(ids.me, 'Asha');
const kiran = person(ids.other, 'Kiran');
const meera = person(P2, 'Meera');

let api: FakeApi;
beforeEach(async () => {
  resetStores();
  mockRouter.push.mockClear();
  mockRouter.replace.mockClear();
  mockRouter.back.mockClear();
  await useAuthStore.getState().signIn(
    authResponseFixture({
      user: {
        id: ids.me,
        status: 'active',
        onboardingComplete: true,
        tutorialComplete: true,
        roles: [],
      },
    }) as never,
  );
  api = new FakeApi()
    .on('GET', '/v1/interests', { status: 200, body: { items: interestsFixture } })
    .on('GET', '/v1/venues/saved', {
      status: 200,
      body: {
        items: [
          {
            id: VENUE,
            name: 'KBR Park',
            address: 'Jubilee Hills',
            location: { lat: 17.42, lng: 78.42 },
            neighbourhoodName: 'Jubilee Hills',
            indoor: false,
            accessibility: { stepFree: true, accessibleRestroom: false, quietSpace: false },
            isPartner: false,
          },
        ],
      },
    })
    .on('GET', '/v1/social/squad', {
      status: 200,
      body: { items: [kiran, meera], nextCursor: null },
    });
});

// ---------- F-ENG-01 ----------

describe("I'm free now (F-ENG-01)", () => {
  it('lists free squad members; plan with them; set and clear your own status', async () => {
    let mine: string | null = null;
    api
      .on('GET', '/v1/me/availability', () => ({
        status: 200,
        body: {
          me: { until: mine, note: '' },
          items: [
            { person: kiran, until: '2026-11-01T15:30:00.000Z', note: 'chai near Madhapur?' },
          ],
        },
      }))
      .on('DELETE', '/v1/me/availability', () => {
        mine = null;
        return { status: 204 };
      });
    await renderWithProviders(<FreeNowStrip />, { fetchFn: api.fetch });
    expect(await screen.findByText('chai near Madhapur?')).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: 'Plan with Kiran' }));
    expect(mockRouter.push).toHaveBeenCalledWith({
      pathname: '/plot',
      params: { inviteUserId: ids.other },
    });
    await fireEvent.press(screen.getByRole('button', { name: "I'm free" }));
    expect(mockRouter.push).toHaveBeenCalledWith('/free');
  });

  it('choosing hours and a note', async () => {
    api.on('PUT', '/v1/me/availability', (c) => ({
      status: 200,
      body: { until: '2026-11-01T16:00:00.000Z', note: (c.body as { note: string }).note },
    }));
    await renderWithProviders(<FreeScreen />, { fetchFn: api.fetch });
    await fireEvent.press(screen.getByRole('radio', { name: '4 hours' }));
    await fireEvent.changeText(screen.getByTestId('free-note'), '  biryani?  ');
    await fireEvent.press(screen.getByTestId('free-save'));
    await waitFor(() => expect(mockRouter.back).toHaveBeenCalled());
    expect(api.callsTo('PUT', '/v1/me/availability')[0]?.body).toEqual({
      hours: 4,
      note: 'biryani?',
    });
  });

  it('nobody free; your own status can be cleared', async () => {
    api
      .on('GET', '/v1/me/availability', {
        status: 200,
        body: { me: { until: '2026-11-01T15:30:00.000Z', note: '' }, items: [] },
      })
      .on('DELETE', '/v1/me/availability', { status: 204 });
    await renderWithProviders(<FreeNowStrip />, { fetchFn: api.fetch });
    expect(await screen.findByText('No one from your squad is free right now.')).toBeOnTheScreen();
    expect(screen.getByTestId('free-me')).toHaveTextContent(/You're free until/);
    await fireEvent.press(screen.getByRole('button', { name: 'Not free anymore' }));
    await waitFor(() => expect(api.callsTo('DELETE', '/v1/me/availability')).toHaveLength(1));
  });
});

// ---------- F-ENG-02 ----------

function summary(over: Partial<CrewSummary> = {}): CrewSummary {
  return {
    id: CREW,
    name: 'Sunday Run Club',
    description: 'Easy 5k around KBR.',
    cover: null,
    interestId: ids.interests[0] ?? null,
    joinPolicy: 'request',
    memberCount: 3,
    nextSession: { eventId: EV1, startsAt: '2026-11-08T00:30:00.000Z' },
    viewer: { role: 'admin', status: 'active' },
    held: false,
    ...over,
  };
}
function crewDetail(over: Partial<CrewDetail> = {}): CrewDetail {
  return {
    ...summary(),
    members: [
      {
        person: me,
        role: 'admin',
        status: 'active',
        attended: 4,
        since: '2026-10-01T00:00:00.000Z',
      },
      {
        person: kiran,
        role: 'member',
        status: 'active',
        attended: 2,
        since: '2026-10-02T00:00:00.000Z',
      },
    ],
    requests: [
      {
        person: meera,
        role: 'member',
        status: 'requested',
        attended: 0,
        since: '2026-10-30T00:00:00.000Z',
      },
    ],
    recurrence: {
      rrule: 'FREQ=WEEKLY;BYDAY=SU',
      startsAt: '2026-11-08T00:30:00.000Z',
      durationMinutes: 90,
      capacity: 20,
      title: '',
      placeLabel: 'KBR Park',
      active: true,
    },
    upcoming: [
      {
        eventId: EV1,
        startsAt: '2026-11-08T00:30:00.000Z',
        endsAt: '2026-11-08T02:00:00.000Z',
        status: 'published',
        goingCount: 5,
        checkedInCount: 0,
        viewerRsvp: 'going',
      },
    ],
    canManage: true,
    ...over,
  };
}

describe('crews (F-ENG-02)', () => {
  it('rules read in plain words', () => {
    const t = ((k: string, o?: Record<string, string>) =>
      `${k}${o ? JSON.stringify(o) : ''}`) as never;
    expect(describeRule(t, 'FREQ=WEEKLY;BYDAY=SA,SU')).toBe(
      'crews.describeWeekly{"days":"crews.days.SA, crews.days.SU"}',
    );
    expect(describeRule(t, 'FREQ=WEEKLY;INTERVAL=2;BYDAY=FR')).toBe(
      'crews.describeBiweekly{"days":"crews.days.FR"}',
    );
    expect(describeRule(t, 'FREQ=MONTHLY;BYDAY=-1FR')).toMatch(/^crews.describeMonthly/);
    expect(describeRule(t, 'FREQ=DAILY')).toBe('crews.describeOther');
    expect(describeRule(t, 'nonsense')).toBe('crews.describeOther');
  });

  it('lists your crews and open ones; opens one', async () => {
    api.on('GET', '/v1/crews', (c) => ({
      status: 200,
      body: {
        items: c.url.includes('scope=discover')
          ? [summary({ name: 'Open crew', viewer: { role: null, status: null } })]
          : [summary()],
        nextCursor: null,
      },
    }));
    await renderWithProviders(<CrewsScreen />, { fetchFn: api.fetch });
    await fireEvent.press(await screen.findByRole('button', { name: /^Sunday Run Club/ }));
    expect(mockRouter.push).toHaveBeenCalledWith({ pathname: '/crews/[id]', params: { id: CREW } });
    await fireEvent.press(screen.getByRole('tab', { name: /Find a crew/ }));
    expect(await screen.findByRole('button', { name: /^Open crew/ })).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: 'Start a crew' }));
    expect(mockRouter.push).toHaveBeenCalledWith('/crews/new');
  });

  it('starting a crew needs a name and what it does', async () => {
    api.on('POST', '/v1/crews', { status: 201, body: crewDetail() });
    await renderWithProviders(<NewCrewScreen />, { fetchFn: api.fetch });
    const save = screen.getByTestId('crew-save');
    await fireEvent.changeText(screen.getByTestId('crew-name'), 'Sunday Run Club');
    expect(save).toBeDisabled();
    await fireEvent.press(await screen.findByRole('radio', { name: 'Interest 0' }));
    await fireEvent.press(screen.getByRole('radio', { name: 'Invite only' }));
    await fireEvent.press(save);
    await waitFor(() =>
      expect(mockRouter.replace).toHaveBeenCalledWith({
        pathname: '/crews/[id]',
        params: { id: CREW },
      }),
    );
    expect(api.callsTo('POST', '/v1/crews')[0]?.body).toMatchObject({
      name: 'Sunday Run Club',
      interestId: ids.interests[0],
      joinPolicy: 'invite_only',
    });
  });

  it('admins see the schedule, approve requests, manage roles and open the chat', async () => {
    mockRouteParams.current = { id: CREW };
    api
      .on('GET', `/v1/crews/${CREW}`, { status: 200, body: crewDetail() })
      .on('GET', `/v1/crews/${CREW}/history`, {
        status: 200,
        body: {
          items: [
            {
              ...crewDetail().upcoming[0],
              eventId: EV2,
              status: 'completed',
              checkedInCount: 6,
              attended: true,
            },
          ],
          attendedCount: 1,
          nextCursor: null,
        },
      })
      .on('POST', `/v1/crews/${CREW}/members/${P2}`, {
        status: 200,
        body: crewDetail({ requests: [] }),
      })
      .on('POST', `/v1/crews/${CREW}/members/${ids.other}`, { status: 200, body: crewDetail() })
      .on('GET', `/v1/crews/${CREW}/chat`, {
        status: 200,
        body: {
          id: OPT(1),
          kind: 'crew',
          state: 'active',
          title: 'Sunday Run Club',
          avatar: null,
          peer: null,
          eventId: null,
          lastMessage: null,
          unreadCount: 0,
          muted: false,
          readOnly: false,
          canCreatePoll: false,
          opensAt: null,
          closesAt: null,
        },
      });
    await renderWithProviders(<CrewScreen />, { fetchFn: api.fetch });
    expect(await screen.findByTestId('crew-schedule')).toHaveTextContent(
      'Every week on Sun · KBR Park',
    );
    expect(await screen.findByTestId('crew-attended')).toHaveTextContent('You made 1 of these');
    await fireEvent.press(screen.getByTestId(`approve-${P2}`));
    await waitFor(() =>
      expect(api.callsTo('POST', `/v1/crews/${CREW}/members/${P2}`)[0]?.body).toEqual({
        action: 'approve',
      }),
    );
    await fireEvent.press(screen.getByTestId(`role-${ids.other}`));
    await waitFor(() =>
      expect(api.callsTo('POST', `/v1/crews/${CREW}/members/${ids.other}`)[0]?.body).toEqual({
        action: 'make_admin',
      }),
    );
    await fireEvent.press(screen.getByTestId(`session-${EV1}`));
    expect(mockRouter.push).toHaveBeenCalledWith({ pathname: '/events/[id]', params: { id: EV1 } });
    await fireEvent.press(screen.getByTestId('crew-set-schedule'));
    expect(mockRouter.push).toHaveBeenCalledWith({
      pathname: '/crews/[id]/schedule',
      params: { id: CREW },
    });
    await fireEvent.press(screen.getByTestId('crew-chat'));
    await waitFor(() =>
      expect(mockRouter.push).toHaveBeenCalledWith({
        pathname: '/chats/[id]',
        params: { id: OPT(1) },
      }),
    );
  });

  it('outsiders ask to join; invitees accept or decline; members can leave', async () => {
    mockRouteParams.current = { id: CREW };
    let viewer: CrewDetail['viewer'] = { role: null, status: null };
    api
      .on('GET', `/v1/crews/${CREW}`, () => ({
        status: 200,
        body: crewDetail({ viewer, canManage: false, requests: [] }),
      }))
      .on('POST', `/v1/crews/${CREW}/membership`, (c) => {
        const action = (c.body as { action: string }).action;
        if (action === 'join') viewer = { role: null, status: 'requested' };
        if (action === 'leave') return { status: 200, body: null };
        return { status: 200, body: crewDetail({ viewer, canManage: false, requests: [] }) };
      });
    await renderWithProviders(<CrewScreen />, { fetchFn: api.fetch });
    await fireEvent.press(await screen.findByRole('button', { name: 'Ask to join' }));
    expect(await screen.findByTestId('crew-requested')).toHaveTextContent('Request sent');
  });

  it('a full crew explains itself; leaving goes back', async () => {
    mockRouteParams.current = { id: CREW };
    api
      .on('GET', `/v1/crews/${CREW}`, {
        status: 200,
        body: crewDetail({
          viewer: { role: 'member', status: 'active' },
          canManage: false,
          requests: [],
        }),
      })
      .on('GET', `/v1/crews/${CREW}/history`, {
        status: 200,
        body: { items: [], attendedCount: 0, nextCursor: null },
      })
      .on('POST', `/v1/crews/${CREW}/membership`, {
        status: 403,
        body: { error: { code: 'NOT_ELIGIBLE', message: 'x', details: { reason: 'LAST_ADMIN' } } },
      });
    await renderWithProviders(<CrewScreen />, { fetchFn: api.fetch });
    await fireEvent.press(await screen.findByTestId('crew-leave'));
    expect(await screen.findByTestId('crew-error')).toHaveTextContent(
      'Make someone else an admin before you leave.',
    );
  });

  it('the schedule picker writes a monthly last-Friday rule at the chosen place', async () => {
    mockRouteParams.current = { id: CREW };
    api
      .on('GET', `/v1/crews/${CREW}`, { status: 200, body: crewDetail({ recurrence: null }) })
      .on('PUT', `/v1/crews/${CREW}/schedule`, { status: 200, body: crewDetail() });
    await renderWithProviders(<CrewScheduleScreen />, { fetchFn: api.fetch });
    await fireEvent.press(await screen.findByRole('radio', { name: 'Every month' }));
    await fireEvent.press(screen.getByRole('radio', { name: 'Fri' }));
    await fireEvent.press(screen.getByRole('radio', { name: 'Last' }));
    await fireEvent.changeText(screen.getByTestId('schedule-date'), '27/11/2026');
    await fireEvent.changeText(screen.getByTestId('schedule-time'), '19:30');
    await fireEvent.press(screen.getByTestId('schedule-save'));
    expect(await screen.findByTestId('schedule-error')).toBeOnTheScreen();
    await fireEvent.press(await screen.findByRole('radio', { name: 'KBR Park' }));
    await fireEvent.press(screen.getByTestId('schedule-save'));
    await waitFor(() => expect(mockRouter.back).toHaveBeenCalled());
    expect(api.callsTo('PUT', `/v1/crews/${CREW}/schedule`)[0]?.body).toMatchObject({
      rrule: 'FREQ=MONTHLY;BYDAY=-1FR',
      startsAt: '2026-11-27T14:00:00.000Z',
      durationMinutes: 90,
      capacity: 20,
      where: { venueId: VENUE },
      active: true,
    });
  });

  it('admins invite people from their squad who are not in yet', async () => {
    mockRouteParams.current = { id: CREW };
    api
      .on('GET', `/v1/crews/${CREW}`, { status: 200, body: crewDetail({ requests: [] }) })
      .on('POST', `/v1/crews/${CREW}/invites`, { status: 200, body: { invited: 1 } });
    await renderWithProviders(<CrewInviteScreen />, { fetchFn: api.fetch });
    expect(await screen.findByRole('checkbox', { name: 'Meera' })).toBeOnTheScreen();
    expect(screen.queryByRole('checkbox', { name: 'Kiran' })).toBeNull(); // already a member
    await fireEvent.press(screen.getByRole('checkbox', { name: 'Meera' }));
    await fireEvent.press(screen.getByTestId('crew-invite-send'));
    await waitFor(() =>
      expect(api.callsTo('POST', `/v1/crews/${CREW}/invites`)[0]?.body).toEqual({ userIds: [P2] }),
    );
  });
});

// ---------- F-ENG-03 ----------

function proposal(over: Partial<ProposalDetail> = {}): ProposalDetail {
  return {
    id: PROP,
    title: 'Board games?',
    description: '',
    status: 'open',
    deadline: new Date(Date.now() + 86_400_000).toISOString(),
    autoLock: true,
    capacity: 8,
    categoryInterestId: ids.interests[0] ?? null,
    creator: me,
    invitees: [kiran],
    options: [
      {
        id: OPT(1),
        kind: 'time',
        label: '',
        startsAt: '2026-11-07T13:30:00.000Z',
        endsAt: '2026-11-07T15:30:00.000Z',
        address: null,
        interestId: null,
        votes: 1,
        voters: [kiran],
        mine: false,
        createdBy: me,
      },
      {
        id: OPT(2),
        kind: 'place',
        label: 'KBR Park',
        startsAt: null,
        endsAt: null,
        address: 'Jubilee Hills',
        interestId: null,
        votes: 0,
        voters: [],
        mine: false,
        createdBy: kiran,
      },
    ],
    eventId: null,
    viewerIsCreator: true,
    held: false,
    canLock: true,
    cancelledReason: null,
    ...over,
  };
}

describe('collaborative plans (F-ENG-03)', () => {
  it('lists votes and starts one', async () => {
    api
      .on('GET', '/v1/proposals', {
        status: 200,
        body: {
          items: [
            {
              id: PROP,
              title: 'Board games?',
              status: 'open',
              deadline: proposal().deadline,
              creator: me,
              optionCount: 2,
              held: false,
              eventId: null,
            },
          ],
        },
      })
      .on('POST', '/v1/proposals', { status: 201, body: proposal() });
    await renderWithProviders(<ProposalsScreen />, { fetchFn: api.fetch });
    await fireEvent.press(await screen.findByRole('button', { name: /^Board games\?/ }));
    expect(mockRouter.push).toHaveBeenCalledWith({
      pathname: '/proposals/[id]',
      params: { id: PROP },
    });

    await renderWithProviders(<NewProposalScreen />, { fetchFn: api.fetch });
    await fireEvent.changeText(screen.getByTestId('proposal-title'), 'Board games?');
    await fireEvent.press(await screen.findByRole('radio', { name: 'Interest 0' }));
    await fireEvent.press(await screen.findByRole('checkbox', { name: 'Kiran' }));
    await fireEvent.press(screen.getByRole('radio', { name: '6 hours' }));
    await fireEvent.press(screen.getByTestId('proposal-save'));
    await waitFor(() =>
      expect(mockRouter.replace).toHaveBeenCalledWith({
        pathname: '/proposals/[id]',
        params: { id: PROP },
      }),
    );
    expect(api.callsTo('POST', '/v1/proposals')[0]?.body).toMatchObject({
      title: 'Board games?',
      inviteeIds: [ids.other],
      autoLock: true,
      categoryInterestId: ids.interests[0],
    });
  });

  it('vote, suggest an activity, then lock a time and place', async () => {
    mockRouteParams.current = { id: PROP };
    let current = proposal();
    api
      .on('GET', `/v1/proposals/${PROP}`, () => ({ status: 200, body: current }))
      .on('POST', `/v1/proposals/${PROP}/votes`, () => {
        current = proposal({
          options: current.options.map((o) =>
            o.id === OPT(2) ? { ...o, votes: 1, mine: true, voters: [me] } : o,
          ),
        });
        return { status: 200, body: current };
      })
      .on('POST', `/v1/proposals/${PROP}/options`, (c) => {
        const label = (c.body as { label: string }).label;
        current = {
          ...current,
          options: [
            ...current.options,
            {
              id: OPT(3),
              kind: 'activity',
              label,
              startsAt: null,
              endsAt: null,
              address: null,
              interestId: null,
              votes: 0,
              voters: [],
              mine: false,
              createdBy: me,
            },
          ],
        };
        return { status: 201, body: current };
      })
      .on('POST', `/v1/proposals/${PROP}/lock`, () => {
        current = proposal({ status: 'locked', eventId: EV1, canLock: false });
        return { status: 200, body: current };
      });
    await renderWithProviders(<ProposalScreen />, { fetchFn: api.fetch });
    await fireEvent.press(await screen.findByRole('checkbox', { name: 'Vote for KBR Park' }));
    await waitFor(() =>
      expect(screen.getByRole('checkbox', { name: 'Vote for KBR Park' })).toBeChecked(),
    );
    await fireEvent.press(screen.getByTestId('add-activity'));
    await fireEvent.changeText(screen.getByTestId('option-activity'), 'Catan');
    await fireEvent.press(screen.getByTestId('option-save'));
    expect(await screen.findByText('Catan')).toBeOnTheScreen();
    expect(screen.getByTestId('proposal-lock')).toBeDisabled();
    await fireEvent.press(screen.getByTestId(`pick-${OPT(1)}`));
    await fireEvent.press(screen.getByTestId(`pick-${OPT(2)}`));
    await fireEvent.press(screen.getByTestId(`pick-${OPT(3)}`));
    await fireEvent.press(screen.getByTestId('proposal-lock'));
    expect(await screen.findByText('Confirmed. The plan is on.')).toBeOnTheScreen();
    expect(api.callsTo('POST', `/v1/proposals/${PROP}/lock`)[0]?.body).toEqual({
      timeOptionId: OPT(1),
      placeOptionId: OPT(2),
      activityOptionId: OPT(3),
    });
    await fireEvent.press(screen.getByTestId('proposal-open-plan'));
    expect(mockRouter.push).toHaveBeenCalledWith({ pathname: '/events/[id]', params: { id: EV1 } });
  });

  it('closed votes explain why; the organiser can call it off', async () => {
    mockRouteParams.current = { id: PROP };
    let current = proposal({ canLock: false });
    api
      .on('GET', `/v1/proposals/${PROP}`, () => ({ status: 200, body: current }))
      .on('POST', `/v1/proposals/${PROP}/cancel`, () => {
        current = proposal({ status: 'cancelled', cancelledReason: 'BY_CREATOR', canLock: false });
        return { status: 200, body: current };
      });
    await renderWithProviders(<ProposalScreen />, { fetchFn: api.fetch });
    await fireEvent.press(await screen.findByTestId('proposal-cancel'));
    expect(await screen.findByText('Called off by the organiser.')).toBeOnTheScreen();
  });
});

// ---------- F-GAM ----------

const badge = (over: Partial<BadgeView>): BadgeView => ({
  key: 'grass_toucher',
  name: { en: 'Grass Toucher', te: 'te', hi: 'hi' },
  description: { en: 'Checked in to your first plan.', te: 'te', hi: 'hi' },
  emoji: '🌱',
  earnedAt: '2026-10-30T10:00:00.000Z',
  progress: { current: 1, target: 1 },
  ...over,
});

describe('badges, streaks, challenges and recaps (F-GAM-01..04)', () => {
  it('badges: earned first, progress for the rest', async () => {
    api.on('GET', '/v1/me/badges', {
      status: 200,
      body: {
        items: [
          badge({
            key: 'certified_outside',
            name: { en: 'Certified Outside', te: 't', hi: 'h' },
            earnedAt: null,
            progress: { current: 3, target: 10 },
          }),
          badge({}),
        ],
      },
    });
    await renderWithProviders(<BadgesScreen />, { fetchFn: api.fetch });
    expect(await screen.findByText('1 earned')).toBeOnTheScreen();
    expect(screen.getByTestId('badge-certified_outside')).toHaveTextContent(/3 of 10/);
    expect(screen.getByTestId('badge-grass_toucher')).toHaveTextContent(/Earned/);
  });

  it('streak card: weeks, best, at risk, freeze', async () => {
    const s: StreakView = {
      current: 3,
      longest: 5,
      thisWeek: false,
      atRisk: true,
      freezeAvailable: true,
      weekKey: '2026-W44',
      recentWeeks: [
        { week: '2026-W43', state: 'out' },
        { week: '2026-W44', state: 'none' },
      ],
    };
    api.on('GET', '/v1/me/streak', { status: 200, body: s });
    await renderWithProviders(<StreakCard />, { fetchFn: api.fetch });
    expect(await screen.findByTestId('streak-current')).toHaveTextContent('3 weeks');
    expect(screen.getByTestId('streak-at-risk')).toBeOnTheScreen();
    expect(screen.getByText('Best: 5')).toBeOnTheScreen();
    expect(screen.getByLabelText('Out, Missed')).toBeOnTheScreen();
  });

  it('challenges: join solo; crew challenges join with a crew; progress shows', async () => {
    const solo: ChallengeView = {
      id: OPT(1),
      title: { en: 'Café crawl', te: 't', hi: 'h' },
      description: { en: '3 new cafés', te: 't', hi: 'h' },
      emoji: '☕',
      startsAt: '2026-11-01T00:00:00.000Z',
      endsAt: '2026-12-01T00:00:00.000Z',
      mode: 'solo',
      target: 3,
      rewardBadge: { key: 'explorer', name: { en: 'Explorer', te: 't', hi: 'h' }, emoji: '🧭' },
      state: 'active',
      joined: false,
      team: null,
      progress: 0,
      completedAt: null,
    };
    const group: ChallengeView = {
      ...solo,
      id: OPT(2),
      mode: 'group',
      title: { en: 'Crew week', te: 't', hi: 'h' },
      rewardBadge: null,
    };
    api
      .on('GET', '/v1/challenges', { status: 200, body: { items: [solo, group] } })
      .on('GET', '/v1/crews', { status: 200, body: { items: [summary()], nextCursor: null } })
      .on('POST', `/v1/challenges/${OPT(1)}/join`, {
        status: 200,
        body: { items: [{ ...solo, joined: true, progress: 1 }, group] },
      })
      .on('POST', `/v1/challenges/${OPT(2)}/join`, {
        status: 200,
        body: {
          items: [
            { ...solo, joined: true, progress: 1 },
            {
              ...group,
              joined: true,
              team: { crewId: CREW, crewName: 'Sunday Run Club' },
              progress: 3,
              completedAt: '2026-11-02T00:00:00.000Z',
            },
          ],
        },
      });
    await renderWithProviders(<ChallengesScreen />, { fetchFn: api.fetch });
    expect(await screen.findByText('Reward: Explorer badge')).toBeOnTheScreen();
    await fireEvent.press(screen.getByTestId(`join-${OPT(1)}`));
    expect(await screen.findByTestId(`challenge-progress-${OPT(1)}`)).toHaveTextContent('1 / 3');
    await fireEvent.press(await screen.findByRole('button', { name: 'Join with Sunday Run Club' }));
    expect(await screen.findByTestId(`challenge-progress-${OPT(2)}`)).toHaveTextContent(
      'Completed',
    );
    expect(api.callsTo('POST', `/v1/challenges/${OPT(2)}/join`)[0]?.body).toEqual({ crewId: CREW });
  });

  const recap: Recap = {
    id: OPT(5),
    period: 'month',
    key: '2026-10',
    stats: {
      eventsAttended: 6,
      eventsHosted: 1,
      peopleMet: 23,
      neighbourhoods: ['Gachibowli', 'Madhapur'],
      topVibe: { en: 'Chill', te: 't', hi: 'h' },
      longestStreak: 4,
      badges: [
        { key: 'grass_toucher', name: { en: 'Grass Toucher', te: 't', hi: 'h' }, emoji: '🌱' },
      ],
      topPeople: [kiran],
    },
    createdAt: '2026-11-01T03:37:00.000Z',
  };

  it('recaps: the list opens the 9:16 card, which shares as an image', async () => {
    mockRouteParams.current = { id: recap.id };
    api
      .on('GET', '/v1/me/recaps', { status: 200, body: { items: [recap] } })
      .on('GET', `/v1/me/recaps/${recap.id}`, { status: 200, body: recap });
    await renderWithProviders(<RecapsScreen />, { fetchFn: api.fetch });
    await fireEvent.press(
      await screen.findByRole('button', { name: /Your October 2026, outside/ }),
    );
    expect(mockRouter.push).toHaveBeenCalledWith({
      pathname: '/recaps/[id]',
      params: { id: recap.id },
    });

    await renderWithProviders(<RecapScreen />, { fetchFn: api.fetch });
    expect(await screen.findByTestId('recap-card')).toHaveTextContent(/23people met/);
    expect(screen.getByText('Top mood: Chill')).toBeOnTheScreen();
    await fireEvent.press(screen.getByTestId('recap-share'));
    await waitFor(() =>
      expect(Sharing.shareAsync).toHaveBeenCalledWith('file:///cache/recap.png', {
        mimeType: 'image/png',
      }),
    );
    expect(captureRef).toHaveBeenCalled();
    jest.mocked(captureRef).mockRejectedValueOnce(new Error('no renderer'));
    await fireEvent.press(screen.getByTestId('recap-share'));
    expect(await screen.findByTestId('recap-error')).toHaveTextContent("Couldn't share right now.");
  });

  it('no recaps yet', async () => {
    api.on('GET', '/v1/me/recaps', { status: 200, body: { items: [] } });
    await renderWithProviders(<RecapsScreen />, { fetchFn: api.fetch });
    expect(
      await screen.findByText('Your first recap lands at the end of the month.'),
    ).toBeOnTheScreen();
  });
});

// ---------- F-GRW-01 ----------

describe('referrals (F-GRW-01)', () => {
  it('shows the code, what a referral earns, the balance and each friend', async () => {
    const r: MyReferrals = {
      code: 'TG7K2P9Q',
      link: 'http://web.test/?ref=TG7K2P9Q',
      balance: { priorityPasses: 2, credits: 1, creditMaxPaise: 50_000 },
      perReferral: { priorityPasses: 2, credits: 1 },
      items: [
        {
          person: kiran,
          status: 'rewarded',
          reason: null,
          createdAt: '2026-10-20T10:00:00.000Z',
          rewardedAt: '2026-10-22T10:00:00.000Z',
        },
        {
          person: null,
          status: 'rejected',
          reason: 'DUPLICATE_PHONE',
          createdAt: '2026-10-21T10:00:00.000Z',
          rewardedAt: null,
        },
        {
          person: person(P3, 'Sam'),
          status: 'pending',
          reason: null,
          createdAt: '2026-10-25T10:00:00.000Z',
          rewardedAt: null,
        },
      ],
    };
    api.on('GET', '/v1/me/referrals', { status: 200, body: r });
    const share = jest
      .spyOn(Share, 'share')
      .mockResolvedValue({ action: 'sharedAction', activityType: undefined });
    await renderWithProviders(<ReferralsScreen />, { fetchFn: api.fetch });
    expect(await screen.findByTestId('referral-code')).toHaveTextContent('TG7K2P9Q');
    expect(
      screen.getByText('• 2 priority passes (jump to the front of a waitlist)'),
    ).toBeOnTheScreen();
    expect(screen.getByTestId('referral-credits')).toHaveTextContent('Free entries: 1');
    expect(screen.getByText(/That number was referred before/)).toBeOnTheScreen();
    expect(screen.getByText('Someone who left')).toBeOnTheScreen();
    await act(async () => {
      await fireEvent.press(screen.getByTestId('referral-share'));
    });
    expect(share).toHaveBeenCalledWith({
      message: expect.stringContaining('http://web.test/?ref=TG7K2P9Q'),
    });
    share.mockRestore();
  });
});

// ---------- plan page and checkout ----------

const host = kiran;
const EVENT_ID = EV1;
function eventFixture(
  viewer: Partial<EventDetail['viewer']> = {},
  over: Partial<EventDetail> = {},
): EventDetail {
  return {
    id: EVENT_ID,
    slug: 'AbCd2345',
    type: 'plan',
    status: 'completed',
    title: 'Sunset run at KBR',
    cover: null,
    startsAt: '2026-10-30T12:30:00.000Z',
    endsAt: '2026-10-30T14:30:00.000Z',
    timezone: 'Asia/Kolkata',
    location: {
      kind: 'exact',
      point: { lat: 17.42, lng: 78.42 },
      address: 'KBR Park gate 1',
      placeName: 'KBR Park',
      neighbourhoodName: 'Jubilee Hills',
    },
    visibility: 'public',
    capacity: 12,
    goingCount: 6,
    spotsLeft: 6,
    waitlistCount: 0,
    pricePaise: 0,
    soloFriendly: true,
    smallGroup: false,
    mystery: false,
    indoor: false,
    accessibility: { stepFree: true, accessibleRestroom: false, quietSpace: false },
    category: null,
    viewer: {
      rsvp: 'checked_in',
      isHost: false,
      hostRole: null,
      invitedBy: null,
      offer: null,
      plusOne: null,
      waitlistPosition: null,
      canRsvp: false,
      blockedReason: null,
      canCheckIn: false,
      payment: null,
      cooldownUntil: null,
      ...viewer,
    },
    description: '',
    hosts: [{ person: host, role: 'host' }],
    interests: [],
    vibeTags: [],
    minGroupSize: 2,
    allowPlusOnes: false,
    balancedMaxSharePct: null,
    soloPercent: 50,
    cancelledReason: null,
    shareUrl: 'http://web.test/e/AbCd2345',
    refundPolicy: { kind: 'none', cutoffHours: 0, partialPct: null },
    perks: [],
    lore: { count: 3, canAdd: true },
    crew: null,
    held: false,
    ...over,
  };
}

describe('rewards and crews on the plan page (F-GRW-01, F-ENG-02)', () => {
  const referrals = (passes: number, credits: number): MyReferrals => ({
    code: 'TG7K2P9Q',
    link: 'http://web.test/?ref=TG7K2P9Q',
    balance: { priorityPasses: passes, credits, creditMaxPaise: 50_000 },
    perReferral: { priorityPasses: 2, credits: 1 },
    items: [],
  });

  it('a crew session links to its crew; a waitlisted person can spend a priority pass', async () => {
    mockRouteParams.current = { id: EV1 };
    let position = 4;
    api
      .on('GET', `/v1/events/${EV1}`, () => ({
        status: 200,
        body: eventFixture(
          {
            rsvp: 'waitlisted',
            waitlistPosition: position,
            canRsvp: false,
            blockedReason: 'ALREADY_IN',
          },
          {
            status: 'published',
            type: 'crew_session',
            crew: { id: CREW, name: 'Sunday Run Club' },
            lore: null,
          },
        ),
      }))
      .on('GET', '/v1/me/referrals', { status: 200, body: referrals(1, 0) })
      .on('POST', `/v1/events/${EV1}/priority-pass`, () => {
        position = 1;
        return { status: 200, body: { position: 1 } };
      });
    await renderWithProviders(<EventScreen />, { fetchFn: api.fetch });
    await fireEvent.press(
      await screen.findByRole('button', { name: 'Crew session · Sunday Run Club' }),
    );
    expect(mockRouter.push).toHaveBeenCalledWith({ pathname: '/crews/[id]', params: { id: CREW } });
    await fireEvent.press(await screen.findByRole('button', { name: 'Use a priority pass' }));
    expect(await screen.findByText("You're #1 on the waitlist now")).toBeOnTheScreen();
    await waitFor(() => expect(screen.getByTestId('rsvp-status')).toHaveTextContent(/#1/));
  });

  it('a free entry pays for a paid plan when it covers the price', async () => {
    mockRouteParams.current = { id: EV1 };
    api
      .on('GET', `/v1/events/${EV1}`, {
        status: 200,
        body: eventFixture(
          { rsvp: null, canRsvp: true },
          {
            status: 'published',
            pricePaise: 30_000,
            refundPolicy: { kind: 'full', cutoffHours: 24, partialPct: null },
            lore: null,
          },
        ),
      })
      .on('GET', '/v1/payments/receipt-email', { status: 200, body: { email: null } })
      .on('GET', '/v1/me/referrals', { status: 200, body: referrals(0, 1) })
      .on('POST', `/v1/events/${EV1}/checkout`, {
        status: 201,
        body: { kind: 'confirmed', paymentId: OPT(9) },
      });
    await renderWithProviders(<CheckoutScreen />, { fetchFn: api.fetch });
    await fireEvent.press(await screen.findByRole('button', { name: 'Use a free entry' }));
    await waitFor(() =>
      expect(mockRouter.replace).toHaveBeenCalledWith({
        pathname: '/events/[id]',
        params: { id: EV1 },
      }),
    );
    expect(api.callsTo('POST', `/v1/events/${EV1}/checkout`)[0]?.body).toMatchObject({
      useCredit: true,
    });
  });

  it('no free entry is offered when the plan costs more than it covers', async () => {
    mockRouteParams.current = { id: EV1 };
    api
      .on('GET', `/v1/events/${EV1}`, {
        status: 200,
        body: eventFixture(
          { rsvp: null, canRsvp: true },
          {
            status: 'published',
            pricePaise: 90_000,
            refundPolicy: { kind: 'full', cutoffHours: 24, partialPct: null },
            lore: null,
          },
        ),
      })
      .on('GET', '/v1/payments/receipt-email', { status: 200, body: { email: null } })
      .on('GET', '/v1/me/referrals', { status: 200, body: referrals(0, 1) });
    await renderWithProviders(<CheckoutScreen />, { fetchFn: api.fetch });
    expect(await screen.findByTestId('pay')).toBeOnTheScreen();
    expect(screen.queryByTestId('use-credit')).toBeNull();
  });
});
