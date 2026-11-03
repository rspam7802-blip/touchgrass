'use client';

import type { CheckoutPage, Translation } from '@touchgrass/shared';
import Script from 'next/script';
import { useState } from 'react';
import { simulateAction } from './actions';

interface RazorpayInstance {
  open: () => void;
}
type RazorpayCtor = new (options: Record<string, unknown>) => RazorpayInstance;

type Phase = 'ready' | 'paid' | 'failed' | 'dismissed';

/**
 * Opens Razorpay Checkout (UPI first). The page only reports what the person did: the ticket is confirmed by
 * the API when Razorpay's signed webhook arrives, never by this page.
 */
export function CheckoutClient({
  token,
  page,
  t,
  language,
}: {
  token: string;
  page: CheckoutPage;
  t: Translation['payments'];
  language: string;
}) {
  const [phase, setPhase] = useState<Phase>(page.status === 'captured' ? 'paid' : 'ready');
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);

  const open = (): void => {
    const Razorpay = (window as unknown as { Razorpay?: RazorpayCtor }).Razorpay;
    if (!Razorpay) return;
    new Razorpay({
      key: page.keyId,
      order_id: page.providerOrderId,
      amount: page.amountPaise,
      currency: 'INR',
      name: 'TouchGrass',
      description: page.eventTitle,
      config: {
        display: {
          blocks: { upi: { name: 'UPI', instruments: [{ method: 'upi' }] } },
          sequence: ['block.upi'],
          preferences: { show_default_blocks: true },
        },
      },
      modal: {
        ondismiss: () => {
          setPhase('dismissed');
        },
      },
      handler: () => {
        setPhase('paid');
      },
    }).open();
  };

  const simulate = async (outcome: 'success' | 'failure'): Promise<void> => {
    setBusy(true);
    const res = await simulateAction(token, outcome);
    setBusy(false);
    setPhase(res.ok && outcome === 'success' ? 'paid' : 'failed');
  };

  const button =
    'min-h-11 rounded-full bg-primary px-6 font-bold text-on-primary disabled:opacity-50';
  const ghost = 'min-h-11 rounded-full border-2 border-border px-6 font-semibold';
  return (
    <div className="flex flex-col gap-4" lang={language}>
      {phase === 'paid' ? (
        <p role="status" className="text-lg font-semibold text-primary" data-testid="checkout-paid">
          {t.paid}
        </p>
      ) : phase === 'failed' ? (
        <p
          role="alert"
          className="font-semibold text-[var(--tg-danger)]"
          data-testid="checkout-failed"
        >
          {t.failed}
        </p>
      ) : null}
      {phase !== 'paid' ? (
        page.simulate ? (
          <>
            <p className="text-muted">{t.testMode}</p>
            <div className="flex flex-wrap gap-3">
              <button
                type="button"
                className={button}
                disabled={busy}
                onClick={() => void simulate('success')}
              >
                {t.simulateSuccess}
              </button>
              <button
                type="button"
                className={ghost}
                disabled={busy}
                onClick={() => void simulate('failure')}
              >
                {t.simulateFailure}
              </button>
            </div>
          </>
        ) : (
          <>
            <Script
              src="https://checkout.razorpay.com/v1/checkout.js"
              strategy="afterInteractive"
              onLoad={() => {
                setLoaded(true);
              }}
            />
            <button
              type="button"
              className={button}
              disabled={!loaded}
              onClick={open}
              data-testid="open-razorpay"
            >
              {phase === 'dismissed' ? t.retry : t.payNow}
            </button>
          </>
        )
      ) : null}
      <a
        href={page.returnUrl}
        className={`${ghost} inline-flex items-center justify-center self-start`}
      >
        {t.returnToApp}
      </a>
    </div>
  );
}
