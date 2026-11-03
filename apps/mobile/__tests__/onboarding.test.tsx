import { fireEvent, screen, waitFor, within } from '@testing-library/react-native';
import * as Location from 'expo-location';
import * as Notifications from 'expo-notifications';
import BirthdayStep from '../app/(onboarding)/birthday';
import CityStep from '../app/(onboarding)/city';
import ContactsStep from '../app/(onboarding)/contacts';
import GenderStep from '../app/(onboarding)/gender';
import InterestsStep from '../app/(onboarding)/interests';
import LocationStep from '../app/(onboarding)/location';
import NameStep from '../app/(onboarding)/name';
import NeighbourhoodStep from '../app/(onboarding)/neighbourhood';
import NotificationsStep from '../app/(onboarding)/notifications';
import PhotosStep from '../app/(onboarding)/photos';
import OnboardingStart from '../app/(onboarding)/start';
import VibesStep from '../app/(onboarding)/vibes';
import WaitlistedScreen from '../app/(onboarding)/waitlisted';
import { composeDate } from '../src/features/me/dob';
import { nextStep, resumeStep } from '../src/features/me/onboarding';
import { useAuthStore } from '../src/stores/auth-store';
import {
  authResponseFixture,
  citiesFixture,
  FakeApi,
  hoodsFixture,
  ids,
  interestsFixture,
  meFixture,
  urlsFixture,
  vibesFixture,
} from '../test/fake-api';
import { mockRouter, renderWithProviders, resetStores } from '../test-utils';

const incomplete = {
  name: false,
  photos: false,
  dateOfBirth: false,
  city: false,
  interests: false,
  complete: false,
};
let api: FakeApi;
const notWaiting = { joined: false, cityId: null, cityName: null, position: null, joinedAt: null };
const waiting = {
  joined: true,
  cityId: ids.waitCity,
  cityName: 'Pune',
  position: 3,
  joinedAt: '2026-11-01T10:00:00.000Z',
};

beforeEach(async () => {
  resetStores();
  await useAuthStore.getState().signIn(authResponseFixture() as never);
  api = new FakeApi()
    .on('GET', '/v1/me', {
      status: 200,
      body: meFixture({
        status: 'onboarding',
        onboarding: incomplete,
        photos: [],
        interests: [],
        vibeTags: [],
        displayName: null,
        gender: null,
        cityId: ids.city,
        neighbourhoodId: null,
      }),
    })
    .on('PATCH', '/v1/me/profile', (c) => ({
      status: 200,
      body: meFixture({ status: 'onboarding', ...(c.body as object) }),
    }))
    .on('POST', '/v1/me/consents', { status: 204 })
    .on('GET', '/v1/cities', { status: 200, body: { items: citiesFixture } })
    .on('GET', `/v1/cities/${ids.city}/neighbourhoods`, {
      status: 200,
      body: { items: hoodsFixture },
    })
    .on('GET', '/v1/interests', { status: 200, body: { items: interestsFixture } })
    .on('GET', '/v1/vibe-tags', { status: 200, body: { items: vibesFixture } })
    .on('GET', '/v1/cities/waitlist', { status: 200, body: notWaiting })
    .on('POST', '/v1/cities/waitlist', (c) => ({
      status: 200,
      body: { ...waiting, cityName: 'cityName' in (c.body as object) ? 'Warangal' : 'Pune' },
    }));
});

describe('resume logic', () => {
  it('resumes at the first unfinished required step', () => {
    expect(resumeStep(incomplete)).toBe('name');
    expect(resumeStep({ ...incomplete, name: true })).toBe('photos');
    expect(resumeStep({ ...incomplete, name: true, photos: true })).toBe('birthday');
    expect(resumeStep({ ...incomplete, name: true, photos: true, dateOfBirth: true })).toBe('city');
    expect(
      resumeStep({ ...incomplete, name: true, photos: true, dateOfBirth: true, city: true }),
    ).toBe('interests');
    expect(
      resumeStep({
        name: true,
        photos: true,
        dateOfBirth: true,
        city: true,
        interests: true,
        complete: true,
      }),
    ).toBe('notifications');
    expect(nextStep('name')).toBe('photos');
    expect(nextStep('location')).toBeNull();
  });

  it('start screen redirects to the resume step, with loading and error states', async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    const slow = new FakeApi().on('GET', '/v1/me', async () => {
      await gate;
      return { status: 200, body: meFixture({ status: 'onboarding', onboarding: incomplete }) };
    });
    await renderWithProviders(<OnboardingStart />, { fetchFn: slow.fetch });
    expect(screen.getByTestId('state-loading')).toBeOnTheScreen();
    release();
    expect(await screen.findByTestId('redirect')).toHaveTextContent('/name');
    const failing = new FakeApi().on('GET', '/v1/me', {
      status: 500,
      body: { error: { code: 'INTERNAL', message: 'x' } },
    });
    await renderWithProviders(<OnboardingStart />, { fetchFn: failing.fetch });
    expect(await screen.findByTestId('state-error')).toBeOnTheScreen();
  });

  it('validates real calendar dates', () => {
    expect(composeDate('20', '5', '1998')).toBe('1998-05-20');
    expect(composeDate('31', '2', '2000')).toBeNull();
    expect(composeDate('1', '1', '98')).toBeNull();
    expect(composeDate('x', '1', '1998')).toBeNull();
  });
});

describe('steps', () => {
  it('name: requires 2+ characters and saves name and pronouns', async () => {
    await renderWithProviders(<NameStep />, { fetchFn: api.fetch });
    expect(screen.getByRole('progressbar', { name: 'Step 1 of 11' })).toBeOnTheScreen();
    expect(screen.getByTestId('onboarding-primary')).toBeDisabled();
    await fireEvent.changeText(screen.getByTestId('name-input'), ' Priya R. ');
    await fireEvent.changeText(screen.getByTestId('pronouns-input'), 'she/her');
    await fireEvent.press(screen.getByTestId('onboarding-primary'));
    await waitFor(() => expect(mockRouter.push).toHaveBeenCalledWith('/photos'));
    expect(api.callsTo('PATCH', '/v1/me/profile')[0]?.body).toEqual({
      displayName: 'Priya R.',
      pronouns: 'she/her',
    });
  });

  it('photos: compresses, uploads by presigned POST, attaches, and gates continue on one photo', async () => {
    let photos: unknown[] = [];
    api
      .on('GET', '/v1/me', () => ({
        status: 200,
        body: meFixture({ status: 'onboarding', photos }),
      }))
      .on('POST', '/v1/media/uploads', {
        status: 201,
        body: {
          assetId: ids.asset,
          upload: {
            url: 'https://s3.test/bucket',
            fields: { key: 'uploads/k', 'Content-Type': 'image/jpeg' },
            expiresAt: '2026-10-31T01:00:00.000Z',
          },
        },
      })
      .on('POST', 'https://s3.test/bucket', { status: 204 })
      .on('POST', '/bucket', { status: 204 })
      .on('GET', /^\/compressed\.jpg$/, { status: 200, body: 'x'.repeat(10) })
      .on('POST', `/v1/media/${ids.asset}/complete`, {
        status: 200,
        body: {
          id: ids.asset,
          purpose: 'profile_photo',
          status: 'processing',
          width: null,
          height: null,
          urls: null,
        },
      })
      .on('PUT', '/v1/me/photos', (c) => {
        photos = (c.body as { mediaAssetIds: string[] }).mediaAssetIds.map((id, position) => ({
          mediaAssetId: id,
          position,
          status: 'ready',
          urls: urlsFixture,
        }));
        return { status: 200, body: meFixture({ status: 'onboarding', photos }) };
      });
    const realFetch = global.fetch;
    global.fetch = (input: string | URL | Request, init?: RequestInit) =>
      (typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.href
          : input.url
      ).startsWith('file:')
        ? Promise.resolve(new Response('x'.repeat(2048)))
        : api.fetch(input, init);
    try {
      await renderWithProviders(<PhotosStep />, { fetchFn: api.fetch });
      await screen.findByRole('button', { name: 'Add photo' });
      expect(screen.getByTestId('onboarding-primary')).toBeDisabled();
      await fireEvent.press(screen.getByRole('button', { name: 'Add photo' }));
      await waitFor(() => expect(api.callsTo('PUT', '/v1/me/photos')).toHaveLength(1));
      expect(api.callsTo('POST', '/v1/media/uploads')[0]?.body).toEqual({
        purpose: 'profile_photo',
        contentType: 'image/jpeg',
        sizeBytes: 2048,
      });
      expect(api.callsTo('PUT', '/v1/me/photos')[0]?.body).toEqual({ mediaAssetIds: [ids.asset] });
      await waitFor(() => expect(screen.getByTestId('onboarding-primary')).not.toBeDisabled());
      await fireEvent.press(screen.getByRole('button', { name: 'Remove photo 1' }));
      await waitFor(() =>
        expect(api.callsTo('PUT', '/v1/me/photos')[1]?.body).toEqual({ mediaAssetIds: [] }),
      );
    } finally {
      global.fetch = realFetch;
    }
  });

  it('birthday: rejects impossible dates, then saves a valid one', async () => {
    await renderWithProviders(<BirthdayStep />, { fetchFn: api.fetch });
    await fireEvent.changeText(screen.getByTestId('dob-day'), '31');
    await fireEvent.changeText(screen.getByTestId('dob-month'), '02');
    await fireEvent.changeText(screen.getByTestId('dob-year'), '1999');
    await fireEvent.press(screen.getByTestId('onboarding-primary'));
    expect(await screen.findByText('Enter a real date.')).toBeOnTheScreen();
    await fireEvent.changeText(screen.getByTestId('dob-day'), '20');
    await fireEvent.press(screen.getByTestId('onboarding-primary'));
    await waitFor(() => expect(mockRouter.push).toHaveBeenCalledWith('/gender'));
    expect(api.callsTo('PATCH', '/v1/me/profile')[0]?.body).toEqual({ dateOfBirth: '1999-02-20' });
  });

  it('birthday: under-18 is blocked and the user is signed out', async () => {
    api.on('PATCH', '/v1/me/profile', {
      status: 403,
      body: { error: { code: 'AGE_RESTRICTED', message: 'x' } },
    });
    await renderWithProviders(<BirthdayStep />, { fetchFn: api.fetch });
    await fireEvent.changeText(screen.getByTestId('dob-day'), '1');
    await fireEvent.changeText(screen.getByTestId('dob-month'), '1');
    await fireEvent.changeText(screen.getByTestId('dob-year'), '2012');
    await fireEvent.press(screen.getByTestId('onboarding-primary'));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'TouchGrass is for people 18 and over.',
    );
    await fireEvent.press(screen.getByRole('button', { name: 'Close' }));
    await waitFor(() => expect(useAuthStore.getState().status).toBe('signedOut'));
  });

  it('gender: optional, single choice, skippable', async () => {
    await renderWithProviders(<GenderStep />, { fetchFn: api.fetch });
    await fireEvent.press(screen.getByRole('radio', { name: 'Non-binary' }));
    await fireEvent.press(screen.getByTestId('onboarding-primary'));
    await waitFor(() =>
      expect(api.callsTo('PATCH', '/v1/me/profile')[0]?.body).toEqual({ gender: 'non_binary' }),
    );
    await fireEvent.press(screen.getByRole('button', { name: 'Skip' }));
    expect(mockRouter.push).toHaveBeenLastCalledWith('/city');
  });

  it('city: open cities continue onboarding', async () => {
    await renderWithProviders(<CityStep />, { fetchFn: api.fetch });
    await fireEvent.press(await screen.findByRole('radio', { name: 'Hyderabad' }));
    await fireEvent.press(screen.getByTestId('onboarding-primary'));
    await waitFor(() => expect(mockRouter.push).toHaveBeenCalledWith('/neighbourhood'));
    expect(api.callsTo('PATCH', '/v1/me/profile')[0]?.body).toEqual({ cityId: ids.city });
  });

  it('city: a city that isn’t open yet joins its waitlist instead (F-GRW-03)', async () => {
    await renderWithProviders(<CityStep />, { fetchFn: api.fetch });
    await fireEvent.press(await screen.findByRole('radio', { name: 'Pune · Coming soon' }));
    const primary = screen.getByTestId('onboarding-primary');
    expect(within(primary).getByText('Join the waitlist')).toBeTruthy();
    await fireEvent.press(primary);
    await waitFor(() => expect(mockRouter.replace).toHaveBeenCalledWith('/waitlisted'));
    expect(api.callsTo('POST', '/v1/cities/waitlist')[0]?.body).toEqual({ cityId: ids.waitCity });
    expect(api.callsTo('PATCH', '/v1/me/profile')).toHaveLength(0);
  });

  it('city: a place that isn’t on TouchGrass can be asked for by name', async () => {
    await renderWithProviders(<CityStep />, { fetchFn: api.fetch });
    await fireEvent.press(await screen.findByTestId('city-missing'));
    expect(screen.getByTestId('onboarding-primary')).toBeDisabled();
    await fireEvent.changeText(screen.getByLabelText('Which city are you in?'), 'Warangal');
    await fireEvent.press(screen.getByTestId('onboarding-primary'));
    await waitFor(() =>
      expect(api.callsTo('POST', '/v1/cities/waitlist')[0]?.body).toEqual({
        cityName: 'Warangal',
      }),
    );
    expect(mockRouter.replace).toHaveBeenCalledWith('/waitlisted');
  });

  it('city: once the city they waited for opens, it is picked for them', async () => {
    api
      .on('GET', '/v1/me', {
        status: 200,
        body: meFixture({ status: 'onboarding', onboarding: incomplete, cityId: null }),
      })
      .on('GET', '/v1/cities', {
        status: 200,
        body: {
          items: citiesFixture.map((c) =>
            c.id === ids.waitCity ? { ...c, launchStatus: 'beta' } : c,
          ),
        },
      })
      .on('GET', '/v1/cities/waitlist', { status: 200, body: waiting });
    await renderWithProviders(<CityStep />, { fetchFn: api.fetch });
    const pune = await screen.findByRole('radio', { name: 'Pune' });
    await waitFor(() => expect(pune).toBeChecked());
    await fireEvent.press(screen.getByTestId('onboarding-primary'));
    await waitFor(() =>
      expect(api.callsTo('PATCH', '/v1/me/profile')[0]?.body).toEqual({ cityId: ids.waitCity }),
    );
  });

  it('waitlisted: shows the place in line and lets people pick again or leave', async () => {
    api
      .on('GET', '/v1/cities/waitlist', { status: 200, body: waiting })
      .on('DELETE', '/v1/cities/waitlist', { status: 204 });
    await renderWithProviders(<WaitlistedScreen />, { fetchFn: api.fetch });
    expect(await screen.findByRole('header', { name: "You're on the list for Pune" })).toBeTruthy();
    expect(screen.getByTestId('waitlist-position')).toHaveTextContent(/#3 in line/);
    await fireEvent.press(screen.getByRole('button', { name: 'Pick another city' }));
    expect(mockRouter.replace).toHaveBeenLastCalledWith({
      pathname: '/city',
      params: { change: '1' },
    });
    await fireEvent.press(screen.getByRole('button', { name: 'Leave the waitlist' }));
    await waitFor(() => expect(api.callsTo('DELETE', '/v1/cities/waitlist')).toHaveLength(1));
  });

  it('city: people already waiting go straight to their place in line', async () => {
    api
      .on('GET', '/v1/me', {
        status: 200,
        body: meFixture({ status: 'onboarding', onboarding: incomplete, cityId: null }),
      })
      .on('GET', '/v1/cities/waitlist', { status: 200, body: waiting });
    await renderWithProviders(<CityStep />, { fetchFn: api.fetch });
    expect(await screen.findByText('/waitlisted')).toBeTruthy();
  });

  it('neighbourhood: lists the city areas', async () => {
    await renderWithProviders(<NeighbourhoodStep />, { fetchFn: api.fetch });
    await fireEvent.press(await screen.findByRole('radio', { name: 'Madhapur' }));
    await fireEvent.press(screen.getByTestId('onboarding-primary'));
    await waitFor(() =>
      expect(api.callsTo('PATCH', '/v1/me/profile')[0]?.body).toEqual({
        neighbourhoodId: ids.hood,
      }),
    );
  });

  it('interests: at least three, shown in the chosen language', async () => {
    api.on('PUT', '/v1/me/interests', {
      status: 200,
      body: { items: interestsFixture.slice(0, 3) },
    });
    await renderWithProviders(<InterestsStep />, { fetchFn: api.fetch, language: 'te' });
    for (const i of [0, 1])
      await fireEvent.press(await screen.findByRole('checkbox', { name: `Interest ${i}-te` }));
    expect(screen.getByTestId('onboarding-primary')).toBeDisabled();
    await fireEvent.press(screen.getByRole('checkbox', { name: 'Interest 2-te' }));
    expect(screen.getByRole('checkbox', { name: 'Interest 2-te' })).toBeChecked();
    await fireEvent.press(screen.getByTestId('onboarding-primary'));
    await waitFor(() =>
      expect(api.callsTo('PUT', '/v1/me/interests')[0]?.body).toEqual({
        interestIds: ids.interests.slice(0, 3),
      }),
    );
  });

  it('vibes: optional multi-select', async () => {
    api.on('PUT', '/v1/me/vibe-tags', { status: 200, body: { items: [] } });
    await renderWithProviders(<VibesStep />, { fetchFn: api.fetch });
    await fireEvent.press(await screen.findByRole('checkbox', { name: 'Vibe 1' }));
    await fireEvent.press(screen.getByTestId('onboarding-primary'));
    await waitFor(() =>
      expect(api.callsTo('PUT', '/v1/me/vibe-tags')[0]?.body).toEqual({
        vibeTagIds: [ids.vibes[1]],
      }),
    );
  });

  it('notifications: records consent and registers the push token', async () => {
    api.on('POST', '/v1/me/devices', { status: 204 });
    await renderWithProviders(<NotificationsStep />, { fetchFn: api.fetch });
    await fireEvent.press(screen.getByRole('button', { name: 'Allow notifications' }));
    await waitFor(() => expect(api.callsTo('POST', '/v1/me/devices')).toHaveLength(1));
    expect(api.callsTo('POST', '/v1/me/consents')[0]?.body).toMatchObject({
      kind: 'notifications',
      granted: true,
    });
    expect(Notifications.getExpoPushTokenAsync).toHaveBeenCalledWith({ projectId: 'eas-test' });
    expect(mockRouter.push).toHaveBeenCalledWith('/contacts');
  });

  it('notifications: "not now" records a refusal and moves on', async () => {
    await renderWithProviders(<NotificationsStep />, { fetchFn: api.fetch });
    await fireEvent.press(screen.getByRole('button', { name: 'Not now' }));
    await waitFor(() => expect(mockRouter.push).toHaveBeenCalledWith('/contacts'));
    expect(api.callsTo('POST', '/v1/me/consents')[0]?.body).toMatchObject({
      kind: 'notifications',
      granted: false,
    });
  });

  it('contacts: asks permission and records the result', async () => {
    await renderWithProviders(<ContactsStep />, { fetchFn: api.fetch });
    await fireEvent.press(screen.getByRole('button', { name: 'Find friends' }));
    await waitFor(() => expect(mockRouter.push).toHaveBeenCalledWith('/location'));
    expect(api.callsTo('POST', '/v1/me/consents')[0]?.body).toMatchObject({
      kind: 'contacts',
      granted: true,
    });
  });

  it('location: records consent, completes onboarding and unlocks the app', async () => {
    api.on('POST', '/v1/me/onboarding/complete', {
      status: 200,
      body: meFixture({ tutorialComplete: false }),
    });
    await renderWithProviders(<LocationStep />, { fetchFn: api.fetch });
    await fireEvent.press(screen.getByRole('button', { name: 'Allow location' }));
    await waitFor(() =>
      expect(useAuthStore.getState().session?.user.onboardingComplete).toBe(true),
    );
    expect(Location.requestForegroundPermissionsAsync).toHaveBeenCalled();
    expect(api.callsTo('POST', '/v1/me/consents')[0]?.body).toMatchObject({
      kind: 'location',
      granted: false,
    });
  });

  it('location: shows server errors when onboarding is incomplete', async () => {
    api.on('POST', '/v1/me/onboarding/complete', {
      status: 409,
      body: { error: { code: 'ONBOARDING_INCOMPLETE', message: 'x' } },
    });
    await renderWithProviders(<LocationStep />, { fetchFn: api.fetch });
    await fireEvent.press(screen.getByRole('button', { name: 'Not now' }));
    expect(await screen.findByText('Finish setting up your profile first.')).toBeOnTheScreen();
  });
});
