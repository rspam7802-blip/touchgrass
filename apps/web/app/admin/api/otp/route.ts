import { AuthResponse, OtpRequestResponse } from '@touchgrass/shared';
import { randomUUID } from 'node:crypto';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import {
  AdminApiError,
  isAdminRole,
  parse,
  rawApi,
  setSessionCookies,
} from '../../../../lib/admin-session';

const Body = z.discriminatedUnion('step', [
  z.object({ step: z.literal('request'), phone: z.string().min(6).max(20) }),
  z.object({
    step: z.literal('verify'),
    phone: z.string().min(6).max(20),
    code: z.string().regex(/^\d{6}$/),
  }),
  // Firebase phone sign-in (D-167): the proof Firebase issued after checking the code in the browser.
  z.object({ step: z.literal('proof'), token: z.string().min(20).max(4096) }),
]);

const adminDevice = () => ({
  deviceId: `admin-web-${randomUUID()}`,
  name: 'Admin dashboard',
  platform: 'web' as const,
  appVersion: 'web',
});

/** Admin sign-in: proxies OTP (or a Firebase phone proof) to the API, then keeps the tokens in httpOnly cookies. Non-admins are refused. */
export async function POST(req: Request): Promise<Response> {
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success)
    return NextResponse.json(
      { error: { code: 'VALIDATION_FAILED', message: 'Invalid request' } },
      { status: 400 },
    );
  const forwarded = { 'x-forwarded-for': req.headers.get('x-forwarded-for') ?? '' };
  try {
    if (parsed.data.step === 'request') {
      const res = await rawApi('/v1/auth/otp/request', {
        method: 'POST',
        body: JSON.stringify({ phone: parsed.data.phone }),
        headers: forwarded,
      });
      return NextResponse.json(await parse(res, OtpRequestResponse));
    }
    const res =
      parsed.data.step === 'proof'
        ? await rawApi('/v1/auth/phone-proof', {
            method: 'POST',
            headers: forwarded,
            body: JSON.stringify({ token: parsed.data.token, device: adminDevice() }),
          })
        : await rawApi('/v1/auth/otp/verify', {
            method: 'POST',
            headers: forwarded,
            body: JSON.stringify({
              phone: parsed.data.phone,
              code: parsed.data.code,
              device: adminDevice(),
            }),
          });
    const auth = await parse(res, AuthResponse);
    if (!isAdminRole(auth.user.roles)) {
      await rawApi('/v1/auth/logout', { method: 'POST', token: auth.accessToken });
      return NextResponse.json(
        { error: { code: 'FORBIDDEN', message: 'This account has no admin access.' } },
        { status: 403 },
      );
    }
    await setSessionCookies(auth);
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof AdminApiError)
      return NextResponse.json(
        { error: { code: err.code, message: err.message } },
        { status: err.status },
      );
    throw err;
  }
}
