import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import type {
  EventDetail,
  HostAnalytics,
  HostStatus,
  PaymentView,
  PayoutLedger,
  Receipt,
} from '@touchgrass/shared';
import * as Linking from 'expo-linking';
import CheckoutScreen from '../app/(app)/events/[id]/checkout';
import EventScreen from '../app/(app)/events/[id]/index';
import PerkScreen from '../app/(app)/events/[id]/perk';
import HostAccountScreen from '../app/(app)/hosting/account';
import HostApplyScreen from '../app/(app)/hosting/apply';
import HostingScreen from '../app/(app)/hosting/index';
import PayoutsScreen from '../app/(app)/hosting/payouts';
import PlotScreen from '../app/(app)/plot';
import PaymentStatusScreen from '../app/(app)/payments/[id]/index';
import ReceiptScreen from '../app/(app)/payments/[id]/receipt';
import PaymentsSettingsScreen from '../app/(app)/settings/payments';
import { money, refundPolicyText } from '../src/features/payments/format';
import { useAuthStore } from '../src/stores/auth-store';
import { authResponseFixture, FakeApi, ids, interestsFixture } from '../test/fake-api';
import { mockRouteParams, mockRouter, renderWithProviders, resetStores } from '../test-utils';

const EVENT_ID = '0192f3a4-5b6c-7d8e-9f01-00000000e001';
const PAY_ID = '0192f3a4-5b6c-7d8e-9f01-0000000a0001';
const PERK_ID = '0192f3a4-5b6c-7d8e-9f01-0000000b0001';
const CHECKOUT_URL = 'http://web.test/pay/tok_abcdefghijklmnopqrstuvwxyz0123456789ABCDEFG';
const host = {
  id: ids.other,
  displayName: 'Ravi K.',
  photo: null,
  verified: true,
  mutualFriendCount: 0,
};

function paidEvent(
  viewer: Partial<EventDetail['viewer']> = {},
  overrides: Partial<EventDetail> = {},
): EventDetail {
  return {
    id: EVENT_ID,
    slug: 'AbCd2345',
    type: 'plan',
    status: 'published',
    title: 'Pottery wheel night',
    cover: null,
    startsAt: '2026-11-07T12:30:00.000Z',
    endsAt: '2026-11-07T15:30:00.000Z',
    timezone: 'Asia/Kolkata',
    location: {
      kind: 'exact',
      point: { lat: 17.43, lng: 78.4 },
      address: 'Road 36, Jubilee Hills',
      placeName: 'Clay Studio',
      neighbourhoodName: 'Jubilee Hills',
    },
    visibility: 'public',
    capacity: 12,
    goingCount: 4,
    spotsLeft: 8,
    waitlistCount: 0,
    pricePaise: 50_000,
    soloFriendly: true,
    smallGroup: false,
    mystery: false,
    indoor: true,
    accessibility: { stepFree: true, accessibleRestroom: false, quietSpace: false },
    category: null,
    viewer: {
      rsvp: null,
      isHost: false,
      hostRole: null,
      invitedBy: null,
      offer: null,
      plusOne: null,
      waitlistPosition: null,
      canRsvp: true,
      blockedReason: null,
      canCheckIn: false,
      payment: null,
      cooldownUntil: null,
      ...viewer,
    },
    description: 'Materials included.',
    hosts: [{ person: host, role: 'host' }],
    interests: [],
    vibeTags: [],
    minGroupSize: 2,
    allowPlusOnes: false,
    chatEnabled: true,
    balancedMaxSharePct: null,
    soloPercent: 50,
    cancelledReason: null,
    shareUrl: 'http://web.test/e/AbCd2345',
    refundPolicy: { kind: 'partial', cutoffHours: 48, partialPct: 50 },
    perks: [],
    lore: null,
    crew: null,
    held: false,
    ...overrides,
  };
}

function paymentView(over: Partial<PaymentView> = {}): PaymentView {
  return {
    id: PAY_ID,
    eventId: EVENT_ID,
    eventTitle: 'Pottery wheel night',
    eventStartsAt: '2026-11-07T12:30:00.000Z',
    eventTimezone: 'Asia/Kolkata',
    status: 'created',
    amountPaise: 50_000,
    refundedPaise: 0,
    holdExpiresAt: new Date(Date.now() + 8 * 60_000).toISOString(),
    capturedAt: null,
    receiptNumber: null,
    refunds: [],
    createdAt: '2026-11-01T10:00:00.000Z',
    ...over,
  };
}

function hostStatus(over: Partial<HostStatus> = {}): HostStatus {
  return {
    canHostFree: true,
    canHostPaid: false,
    application: null,
    account: null,
    platformFeeBps: 1000,
    gstBps: 1800,
    ...over,
  };
}

let api: FakeApi;
let openURL: jest.SpyInstance;
beforeEach(async () => {
  resetStores();
  mockRouter.push.mockClear();
  mockRouter.replace.mockClear();
  mockRouter.back.mockClear();
  openURL = jest.spyOn(Linking, 'openURL').mockResolvedValue(true);
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
  mockRouteParams.current = { id: EVENT_ID };
  api = new FakeApi();
});
afterEach(() => {
  openURL.mockRestore();
});

describe('payment formatting', () => {
  it('formats money and every refund policy kind', () => {
    const t = (k: string, o?: Record<string, unknown>) => `${k}${o ? JSON.stringify(o) : ''}`;
    expect(money(50_000, 'en')).toBe('₹500');
    expect(money(49_950, 'xx')).toBe('₹499.50');
    expect(refundPolicyText(t, { kind: 'none', cutoffHours: 0, partialPct: null })).toBe(
      'payments.refundNone payments.refundHostCancel',
    );
    expect(refundPolicyText(t, { kind: 'full', cutoffHours: 24, partialPct: null })).toContain(
      '"hours":24',
    );
    expect(refundPolicyText(t, { kind: 'partial', cutoffHours: 48, partialPct: 50 })).toContain(
      '"pct":50',
    );
  });
});

describe('paid plan detail (F-PAY-01/02)', () => {
  it('shows price and refund policy; pulling up goes to checkout', async () => {
    api.on('GET', `/v1/events/${EVENT_ID}`, { status: 200, body: paidEvent() });
    await renderWithProviders(<EventScreen />, { fetchFn: api.fetch });
    expect(await screen.findByTestId('event-price')).toHaveTextContent('₹500');
    expect(screen.getByTestId('event-refund-policy')).toHaveTextContent(
      /50% back if you cancel at least 48 h before/,
    );
    await fireEvent.press(screen.getByRole('button', { name: 'Pay ₹500 and pull up' }));
    expect(mockRouter.push).toHaveBeenCalledWith({
      pathname: '/events/[id]/checkout',
      params: { id: EVENT_ID },
    });
  });

  it('an open checkout can be continued', async () => {
    api.on('GET', `/v1/events/${EVENT_ID}`, {
      status: 200,
      body: paidEvent({
        rsvp: 'held',
        canRsvp: false,
        blockedReason: 'ALREADY_IN',
        payment: {
          id: PAY_ID,
          status: 'created',
          holdExpiresAt: paymentView().holdExpiresAt,
          amountPaise: 50_000,
        },
      }),
    });
    await renderWithProviders(<EventScreen />, { fetchFn: api.fetch });
    expect(await screen.findByTestId('rsvp-status')).toHaveTextContent('Waiting for payment');
    await fireEvent.press(screen.getByTestId('continue-payment'));
    expect(mockRouter.push).toHaveBeenCalledWith({
      pathname: '/payments/[id]',
      params: { id: PAY_ID },
    });
  });

  it('perks at partner venues: redeemable ones open the pass, others say why', async () => {
    const perk = (id: string, title: string) => ({
      id,
      venueId: '0192f3a4-5b6c-7d8e-9f01-0000000c0001',
      title,
      description: '',
      minGroupSize: 4,
      validUntil: null,
      active: true,
    });
    api.on('GET', `/v1/events/${EVENT_ID}`, {
      status: 200,
      body: paidEvent(
        { rsvp: 'going', canRsvp: false, blockedReason: 'ALREADY_IN' },
        {
          perks: [
            {
              perk: perk(PERK_ID, '10% off'),
              venueName: 'Clay Studio',
              canRedeem: true,
              reason: null,
              redeemedAt: null,
            },
            {
              perk: perk('0192f3a4-5b6c-7d8e-9f01-0000000b0002', 'Free chai'),
              venueName: 'Clay Studio',
              canRedeem: false,
              reason: 'GROUP_TOO_SMALL',
              redeemedAt: null,
            },
          ],
        },
      ),
    });
    await renderWithProviders(<EventScreen />, { fetchFn: api.fetch });
    expect(await screen.findByText('This perk needs a bigger group.')).toBeOnTheScreen();
    expect(screen.getAllByText(/For groups of 4\+/)).toHaveLength(2);
    await fireEvent.press(screen.getByTestId(`redeem-${PERK_ID}`));
    expect(mockRouter.push).toHaveBeenCalledWith({
      pathname: '/events/[id]/perk',
      params: { id: EVENT_ID, perkId: PERK_ID },
    });
  });
});

describe('checkout (F-PAY-01)', () => {
  beforeEach(() => {
    api
      .on('GET', `/v1/events/${EVENT_ID}`, { status: 200, body: paidEvent() })
      .on('GET', '/v1/payments/receipt-email', {
        status: 200,
        body: { email: 'priya@example.com' },
      });
  });

  it('pre-fills the receipt email, opens the secure checkout and waits on the status screen', async () => {
    api.on('POST', `/v1/events/${EVENT_ID}/checkout`, {
      status: 201,
      body: {
        kind: 'checkout',
        session: {
          paymentId: PAY_ID,
          status: 'created',
          amountPaise: 50_000,
          holdExpiresAt: paymentView().holdExpiresAt,
          checkoutUrl: CHECKOUT_URL,
        },
      },
    });
    await renderWithProviders(<CheckoutScreen />, { fetchFn: api.fetch });
    await waitFor(() => {
      expect(screen.getByTestId('receipt-email')).toHaveProp('value', 'priya@example.com');
    });
    expect(screen.getByTestId('checkout-refund-policy')).toHaveTextContent(/If the host cancels/);
    await fireEvent.press(screen.getByTestId('pay'));
    await waitFor(() => {
      expect(openURL).toHaveBeenCalledWith(CHECKOUT_URL);
    });
    const call = api.callsTo('POST', `/v1/events/${EVENT_ID}/checkout`)[0];
    expect(call?.body).toEqual({
      receiptEmail: 'priya@example.com',
      fromOffer: false,
      useCredit: false,
    });
    expect(call?.headers['idempotency-key']).toMatch(/^checkout-/);
    expect(mockRouter.replace).toHaveBeenCalledWith({
      pathname: '/payments/[id]',
      params: { id: PAY_ID, url: CHECKOUT_URL },
    });
  });

  it('rejects a bad email before paying, and explains a full plan', async () => {
    api.on('POST', `/v1/events/${EVENT_ID}/checkout`, {
      status: 201,
      body: { kind: 'waitlisted' },
    });
    await renderWithProviders(<CheckoutScreen />, { fetchFn: api.fetch });
    await fireEvent.changeText(await screen.findByTestId('receipt-email'), 'nope');
    expect(screen.getByTestId('pay')).toBeDisabled();
    await fireEvent.changeText(screen.getByTestId('receipt-email'), '');
    await fireEvent.press(screen.getByTestId('pay'));
    expect(await screen.findByTestId('checkout-notice')).toHaveTextContent(/waitlist/i);
    expect(openURL).not.toHaveBeenCalled();
  });

  it('shows payment-provider trouble without charging', async () => {
    api.on('POST', `/v1/events/${EVENT_ID}/checkout`, {
      status: 502,
      body: { error: { code: 'PAYMENT_PROVIDER_ERROR', message: 'x' } },
    });
    await renderWithProviders(<CheckoutScreen />, { fetchFn: api.fetch });
    await fireEvent.press(await screen.findByTestId('pay'));
    expect(await screen.findByTestId('checkout-error')).toHaveTextContent(/Nothing was charged/);
  });
});

describe('payment status and receipts (F-PAY-01, F-PAY-05)', () => {
  it('waiting: retry opens the same checkout; cancel gives the seat back', async () => {
    mockRouteParams.current = { id: PAY_ID, url: CHECKOUT_URL };
    api
      .on('GET', `/v1/payments/${PAY_ID}`, { status: 200, body: paymentView({ status: 'failed' }) })
      .on('POST', `/v1/payments/${PAY_ID}/cancel`, { status: 204 });
    await renderWithProviders(<PaymentStatusScreen />, { fetchFn: api.fetch });
    expect(await screen.findByTestId('payment-status')).toHaveTextContent(/did not go through/);
    await fireEvent.press(screen.getByRole('button', { name: 'Try again' }));
    expect(openURL).toHaveBeenCalledWith(CHECKOUT_URL);
    await fireEvent.press(screen.getByTestId('cancel-checkout'));
    await waitFor(() => {
      expect(api.callsTo('POST', `/v1/payments/${PAY_ID}/cancel`)).toHaveLength(1);
    });
    expect(mockRouter.back).toHaveBeenCalled();
  });

  it('opened from a link (no checkout URL): paying again asks for a fresh link', async () => {
    mockRouteParams.current = { id: PAY_ID };
    api
      .on('GET', `/v1/payments/${PAY_ID}`, { status: 200, body: paymentView() })
      .on('POST', `/v1/events/${EVENT_ID}/checkout`, {
        status: 201,
        body: {
          kind: 'checkout',
          session: {
            paymentId: PAY_ID,
            status: 'created',
            amountPaise: 50_000,
            holdExpiresAt: paymentView().holdExpiresAt,
            checkoutUrl: CHECKOUT_URL,
          },
        },
      });
    await renderWithProviders(<PaymentStatusScreen />, { fetchFn: api.fetch });
    expect(await screen.findByTestId('payment-status')).toHaveTextContent('Checking your payment…');
    await fireEvent.press(screen.getByTestId('pay-again'));
    await waitFor(() => {
      expect(openURL).toHaveBeenCalledWith(CHECKOUT_URL);
    });
  });

  it('paid: ticket and receipt; refunds are listed', async () => {
    mockRouteParams.current = { id: PAY_ID };
    api.on('GET', `/v1/payments/${PAY_ID}`, {
      status: 200,
      body: paymentView({
        status: 'partially_refunded',
        refundedPaise: 25_000,
        receiptNumber: 'TG-2026-000042',
        capturedAt: '2026-11-01T10:01:00.000Z',
        refunds: [
          {
            id: '0192f3a4-5b6c-7d8e-9f01-0000000d0001',
            amountPaise: 25_000,
            status: 'processed',
            reason: 'BEFORE_CUTOFF',
            createdAt: '2026-11-02T10:00:00.000Z',
            processedAt: '2026-11-03T10:00:00.000Z',
          },
        ],
      }),
    });
    await renderWithProviders(<PaymentStatusScreen />, { fetchFn: api.fetch });
    expect(await screen.findByText(/Refunded · ₹250/)).toBeOnTheScreen();
    await fireEvent.press(screen.getByTestId('open-receipt'));
    expect(mockRouter.push).toHaveBeenCalledWith({
      pathname: '/payments/[id]/receipt',
      params: { id: PAY_ID },
    });
    await fireEvent.press(screen.getByTestId('open-ticket'));
    expect(mockRouter.push).toHaveBeenCalledWith({
      pathname: '/events/[id]/ticket',
      params: { id: EVENT_ID },
    });
  });

  it('expired holds say so and offer nothing to pay', async () => {
    mockRouteParams.current = { id: PAY_ID };
    api.on('GET', `/v1/payments/${PAY_ID}`, {
      status: 200,
      body: paymentView({ status: 'expired', holdExpiresAt: '2026-11-01T10:10:00.000Z' }),
    });
    await renderWithProviders(<PaymentStatusScreen />, { fetchFn: api.fetch });
    expect(await screen.findByTestId('payment-status')).toHaveTextContent(/hold ran out/);
    expect(screen.queryByTestId('pay-again')).toBeNull();
  });

  it('the receipt shows fee and GST included, refunds and seller', async () => {
    mockRouteParams.current = { id: PAY_ID };
    const receipt: Receipt = {
      number: 'TG-2026-000042',
      paymentId: PAY_ID,
      issuedAt: '2026-11-01T10:01:00.000Z',
      buyerName: 'Priya R.',
      event: { id: EVENT_ID, title: 'Pottery wheel night', startsAt: '2026-11-07T12:30:00.000Z' },
      hostName: 'Ravi K.',
      amountPaise: 50_000,
      method: 'upi',
      platformFeePaise: 5_000,
      gstPaise: 900,
      refunds: [],
      netPaidPaise: 25_000,
      sellerName: 'TouchGrass',
      sellerGstin: '36ABCDE1234F1Z5',
    };
    api.on('GET', `/v1/payments/${PAY_ID}/receipt`, { status: 200, body: receipt });
    await renderWithProviders(<ReceiptScreen />, { fetchFn: api.fetch });
    expect(await screen.findByText('Receipt TG-2026-000042')).toBeOnTheScreen();
    expect(screen.getByTestId('receipt-amount')).toHaveProp('accessibilityLabel', 'Paid: ₹500');
    expect(screen.getByTestId('receipt-net')).toHaveProp('accessibilityLabel', 'Total paid: ₹250');
    expect(screen.getByText('− ₹250')).toBeOnTheScreen();
    expect(screen.getByText(/GSTIN 36ABCDE1234F1Z5/)).toBeOnTheScreen();
    expect(screen.getByText('UPI')).toBeOnTheScreen();
  });

  it('settings list payments and save the receipt email', async () => {
    api
      .on('GET', '/v1/payments', {
        status: 200,
        body: {
          items: [paymentView({ status: 'captured', receiptNumber: 'TG-2026-000042' })],
          nextCursor: null,
        },
      })
      .on('GET', '/v1/payments/receipt-email', { status: 200, body: { email: null } })
      .on('PUT', '/v1/payments/receipt-email', (c) => ({ status: 200, body: c.body }));
    await renderWithProviders(<PaymentsSettingsScreen />, { fetchFn: api.fetch });
    await fireEvent.press(await screen.findByTestId(`payment-${PAY_ID}`));
    expect(mockRouter.push).toHaveBeenCalledWith({
      pathname: '/payments/[id]',
      params: { id: PAY_ID },
    });
    await fireEvent.changeText(screen.getByTestId('settings-receipt-email'), 'me@example.com');
    await fireEvent.press(screen.getByTestId('save-receipt-email'));
    await waitFor(() => {
      expect(api.callsTo('PUT', '/v1/payments/receipt-email')[0]?.body).toEqual({
        email: 'me@example.com',
      });
    });
    expect(await screen.findByText('Saved')).toBeOnTheScreen();
  });

  it('settings show an empty history', async () => {
    api
      .on('GET', '/v1/payments', { status: 200, body: { items: [], nextCursor: null } })
      .on('GET', '/v1/payments/receipt-email', { status: 200, body: { email: null } });
    await renderWithProviders(<PaymentsSettingsScreen />, { fetchFn: api.fetch });
    expect(await screen.findByText('No payments yet.')).toBeOnTheScreen();
  });
});

describe('hosting (F-HST-01/02, F-PAY-03)', () => {
  const analytics: HostAnalytics = {
    totals: {
      events: 1,
      views: 20,
      rsvps: 5,
      conversionPct: 25,
      checkIns: 4,
      noShows: 1,
      repeatAttendees: 2,
      averageRating: null,
      ratingsCount: 0,
      themes: [],
      revenuePaise: 150_000,
    },
    events: [
      {
        eventId: EVENT_ID,
        title: 'Pottery wheel night',
        startsAt: '2026-11-07T12:30:00.000Z',
        status: 'completed',
        views: 20,
        rsvps: 5,
        conversionPct: 25,
        checkIns: 4,
        noShows: 1,
        repeatAttendees: 2,
        averageRating: null,
        ratingsCount: 0,
        themes: [],
        revenuePaise: 150_000,
      },
    ],
  };

  it('not applied yet: apply; insights show for plans already hosted', async () => {
    api
      .on('GET', '/v1/host/status', { status: 200, body: hostStatus() })
      .on('GET', '/v1/host/analytics', { status: 200, body: analytics });
    await renderWithProviders(<HostingScreen />, { fetchFn: api.fetch });
    expect(await screen.findByLabelText('Conversion: 25%')).toBeOnTheScreen();
    expect(screen.getByLabelText('Revenue: ₹1,500')).toBeOnTheScreen();
    expect(screen.getByLabelText('Rating: No ratings yet')).toBeOnTheScreen();
    await fireEvent.press(screen.getByTestId('host-apply'));
    expect(mockRouter.push).toHaveBeenCalledWith('/hosting/apply');
    await fireEvent.press(screen.getByTestId(`analytics-${EVENT_ID}`));
    expect(mockRouter.push).toHaveBeenCalledWith({
      pathname: '/hosting/event/[id]',
      params: { id: EVENT_ID },
    });
  });

  it('approved without payouts: set up KYC; with an active account: the ledger', async () => {
    const approved = {
      id: '0192f3a4-5b6c-7d8e-9f01-0000000e0001',
      status: 'approved' as const,
      about: 'a',
      experience: 'b',
      eventIdeas: 'c',
      links: [],
      reviewNote: null,
      createdAt: '2026-10-01T10:00:00.000Z',
      reviewedAt: '2026-10-02T10:00:00.000Z',
    };
    api
      .on('GET', '/v1/host/status', {
        status: 200,
        body: hostStatus({ canHostPaid: true, application: approved }),
      })
      .on('GET', '/v1/host/analytics', { status: 200, body: { ...analytics, events: [] } });
    const first = await renderWithProviders(<HostingScreen />, { fetchFn: api.fetch });
    expect(await screen.findByTestId('host-approved')).toBeOnTheScreen();
    expect(screen.getByText('Plot something to see insights.')).toBeOnTheScreen();
    await fireEvent.press(screen.getByTestId('start-kyc'));
    expect(mockRouter.push).toHaveBeenCalledWith('/hosting/account');
    await first.unmount();

    api.on('GET', '/v1/host/status', {
      status: 200,
      body: hostStatus({
        canHostPaid: true,
        application: approved,
        account: {
          status: 'activated',
          legalBusinessName: 'Ravi Rides',
          contactName: 'Ravi',
          email: 'r@example.com',
          createdAt: '2026-10-03T10:00:00.000Z',
          activatedAt: '2026-10-04T10:00:00.000Z',
        },
      }),
    });
    await renderWithProviders(<HostingScreen />, { fetchFn: api.fetch });
    expect(await screen.findByTestId('kyc-status')).toHaveTextContent('Payouts are active.');
    expect(screen.queryByTestId('start-kyc')).toBeNull();
    await fireEvent.press(screen.getByTestId('open-payouts'));
    expect(mockRouter.push).toHaveBeenCalledWith('/hosting/payouts');
  });

  it('application form validates, then submits', async () => {
    api.on('POST', '/v1/host/applications', (c) => ({
      status: 201,
      body: {
        id: '0192f3a4-5b6c-7d8e-9f01-0000000e0002',
        status: 'pending',
        ...(c.body as object),
        reviewNote: null,
        createdAt: '2026-11-01T10:00:00.000Z',
        reviewedAt: null,
      },
    }));
    await renderWithProviders(<HostApplyScreen />, { fetchFn: api.fetch });
    await fireEvent.press(screen.getByTestId('host-submit'));
    expect(api.callsTo('POST', '/v1/host/applications')).toHaveLength(0);
    await fireEvent.changeText(
      screen.getByTestId('host-about'),
      'I run a Sunday cycling group in Gachibowli.',
    );
    await fireEvent.changeText(
      screen.getByTestId('host-experience'),
      'Thirty rides for groups of ten to forty.',
    );
    await fireEvent.changeText(
      screen.getByTestId('host-eventIdeas'),
      'Sunrise rides ending at a partner cafe.',
    );
    await fireEvent.changeText(screen.getByTestId('host-link'), 'https://instagram.com/rides');
    await fireEvent.press(screen.getByTestId('host-submit'));
    await waitFor(() => {
      expect(mockRouter.back).toHaveBeenCalled();
    });
    expect(api.callsTo('POST', '/v1/host/applications')[0]?.body).toMatchObject({
      links: ['https://instagram.com/rides'],
    });
  });

  it('payout setup form creates the Route account', async () => {
    api.on('POST', '/v1/host/account', (c) => ({
      status: 201,
      body: {
        status: 'created',
        ...(c.body as object),
        createdAt: '2026-11-01T10:00:00.000Z',
        activatedAt: null,
      },
    }));
    await renderWithProviders(<HostAccountScreen />, { fetchFn: api.fetch });
    await fireEvent.changeText(screen.getByTestId('kyc-email'), 'bad');
    await fireEvent.press(screen.getByTestId('kyc-submit'));
    expect(api.callsTo('POST', '/v1/host/account')).toHaveLength(0);
    await fireEvent.changeText(screen.getByTestId('kyc-legalBusinessName'), 'Ravi Rides');
    await fireEvent.changeText(screen.getByTestId('kyc-contactName'), 'Ravi K');
    await fireEvent.changeText(screen.getByTestId('kyc-email'), 'ravi@example.com');
    await fireEvent.press(screen.getByTestId('kyc-submit'));
    await waitFor(() => {
      expect(mockRouter.back).toHaveBeenCalled();
    });
  });

  it('the payout ledger itemises sales, refunds, fee and GST', async () => {
    const ledger: PayoutLedger = {
      items: [
        {
          id: '0192f3a4-5b6c-7d8e-9f01-0000000f0001',
          eventId: EVENT_ID,
          eventTitle: 'Pottery wheel night',
          status: 'on_hold',
          grossPaise: 100_000,
          refundsPaise: 10_000,
          platformFeePaise: 9_000,
          gstPaise: 1_620,
          netPaise: 79_380,
          holdReason: 'KYC_REQUIRED',
          createdAt: '2026-11-09T10:00:00.000Z',
          paidAt: null,
        },
      ],
      nextCursor: null,
      totals: { paidPaise: 0, pendingPaise: 79_380 },
    };
    api.on('GET', '/v1/host/payouts', { status: 200, body: ledger });
    await renderWithProviders(<PayoutsScreen />, { fetchFn: api.fetch });
    expect(await screen.findByTestId('payout-totals')).toHaveTextContent(
      'Paid out: ₹0 · Coming up: ₹793.80',
    );
    expect(screen.getByText('Finish payout setup to release this.')).toBeOnTheScreen();
    expect(screen.getByText('You get: ₹793.80')).toBeOnTheScreen();
  });

  it('approved hosts set a price and refund policy when plotting, with their share shown', async () => {
    mockRouteParams.current = {};
    api
      .on('GET', '/v1/host/status', { status: 200, body: hostStatus({ canHostPaid: true }) })
      .on('GET', '/v1/interests', { status: 200, body: { items: interestsFixture } })
      .on('GET', '/v1/venues/saved', { status: 200, body: { items: [] } });
    await renderWithProviders(<PlotScreen />, { fetchFn: api.fetch });
    // Plans start free; approved hosts switch to Paid to set a price.
    expect(screen.queryByTestId('plot-price')).toBeNull();
    await fireEvent.press(await screen.findByRole('tab', { name: 'Paid' }));
    await fireEvent.changeText(await screen.findByTestId('plot-price'), '500');
    expect(screen.getByTestId('plot-host-share')).toHaveTextContent(
      'You get about ₹441 per ticket.',
    );
    await fireEvent.press(screen.getByTestId('plot-refund-partial'));
    expect(screen.getByTestId('plot-partial-pct')).toBeOnTheScreen();
    await fireEvent.press(screen.getByTestId('plot-refund-none'));
    expect(screen.queryByTestId('plot-cutoff')).toBeNull();
  });

  it('everyone else sees no price field', async () => {
    mockRouteParams.current = {};
    api
      .on('GET', '/v1/host/status', { status: 200, body: hostStatus() })
      .on('GET', '/v1/interests', { status: 200, body: { items: interestsFixture } })
      .on('GET', '/v1/venues/saved', { status: 200, body: { items: [] } });
    await renderWithProviders(<PlotScreen />, { fetchFn: api.fetch });
    expect(await screen.findByTestId('plot-submit')).toBeOnTheScreen();
    await waitFor(() => {
      expect(api.callsTo('GET', '/v1/host/status')).toHaveLength(1);
    });
    expect(screen.queryByTestId('plot-price')).toBeNull();
    expect(screen.queryByRole('tab', { name: 'Paid' })).toBeNull();
    expect(screen.getByTestId('plot-paid-hint')).toBeOnTheScreen();
  });
});

describe('perk pass (F-PAY-04)', () => {
  it('shows the QR and spaced-out code for staff, then the used state', async () => {
    mockRouteParams.current = { id: EVENT_ID, perkId: PERK_ID };
    api.on('POST', `/v1/events/${EVENT_ID}/perks/${PERK_ID}/pass`, {
      status: 201,
      body: {
        code: 'AB3C4D',
        qr: 'http://web.test/r/tok_abcdefghijklmnopqrstuvwxyz0123456789ABCDEF',
        perkTitle: '10% off',
        venueName: 'Clay Studio',
        expiresAt: '2026-11-07T21:30:00.000Z',
        redeemedAt: null,
      },
    });
    const first = await renderWithProviders(<PerkScreen />, { fetchFn: api.fetch });
    expect(await screen.findByTestId('perk-code')).toHaveProp(
      'accessibilityLabel',
      'Code A B 3 C 4 D',
    );
    expect(screen.getByText('Show this to the staff')).toBeOnTheScreen();
    await first.unmount();

    api.on('POST', `/v1/events/${EVENT_ID}/perks/${PERK_ID}/pass`, {
      status: 201,
      body: {
        code: 'AB3C4D',
        qr: '',
        perkTitle: '10% off',
        venueName: 'Clay Studio',
        expiresAt: '2026-11-07T21:30:00.000Z',
        redeemedAt: '2026-11-07T13:00:00.000Z',
      },
    });
    await renderWithProviders(<PerkScreen />, { fetchFn: api.fetch });
    expect(await screen.findByTestId('perk-redeemed')).toBeOnTheScreen();
  });
});
