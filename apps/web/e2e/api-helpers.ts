import { type APIRequestContext, expect } from '@playwright/test';

export const API = `http://localhost:${process.env.API_E2E_PORT ?? '4100'}`;

/** A distinct client IP per sign-in (the e2e API trusts one proxy hop). */
export const freshIp = (): Record<string, string> => ({
  'X-Forwarded-For': `10.${String(Math.floor(Math.random() * 250))}.${String(Math.floor(Math.random() * 250))}.${String(Math.floor(Math.random() * 250) + 1)}`,
});

export async function token(api: APIRequestContext, phone: string): Promise<string> {
  const ip = freshIp();
  const sent = await api.post(`${API}/v1/auth/otp/request`, { data: { phone }, headers: ip });
  expect(sent.status(), await sent.text()).toBe(200);
  const res = await api.post(`${API}/v1/auth/otp/verify`, {
    headers: ip,
    data: { phone, code: '000000', device: { deviceId: `e2e-${phone}`, platform: 'android' } },
  });
  expect(res.status(), await res.text()).toBe(200);
  return ((await res.json()) as { accessToken: string }).accessToken;
}
