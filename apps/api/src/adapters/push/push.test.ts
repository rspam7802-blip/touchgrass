import { describe, expect, it } from 'vitest';
import { fakeFetch, jsonBody } from '../../test-support/env.js';
import { ExpoPushSender } from './expo.push.js';
import { FakePushSender } from './fake.push.js';
import { isExpoPushToken, type PushMessage } from './push.port.js';

const msg = (i: number): PushMessage => ({
  to: `ExponentPushToken[t${i}]`,
  title: 't',
  body: 'b',
  data: { url: 'touchgrass://e/1' },
});

describe('ExpoPushSender', () => {
  it('chunks by 100 and maps tickets, including errors', async () => {
    const ok = (n: number) => ({
      body: { data: Array.from({ length: n }, (_, i) => ({ status: 'ok', id: `id${i}` })) },
    });
    const f = fakeFetch([
      ok(100),
      {
        body: {
          data: [
            { status: 'error', message: 'gone', details: { error: 'DeviceNotRegistered' } },
            { status: 'error', details: { error: 'Weird' } },
            { status: 'ok', id: 'z' },
          ],
        },
      },
    ]);
    const tickets = await new ExpoPushSender('tok', f.fetch).send(
      Array.from({ length: 103 }, (_, i) => msg(i)),
    );
    expect(f.calls).toHaveLength(2);
    expect((jsonBody(f.calls[0]?.init) as unknown[]).length).toBe(100);
    expect((f.calls[0]?.init?.headers as Record<string, string>).authorization).toBe('Bearer tok');
    expect(tickets).toHaveLength(103);
    expect(tickets[100]).toEqual({
      status: 'error',
      error: 'DeviceNotRegistered',
      message: 'gone',
    });
    expect(tickets[101]).toEqual({ status: 'error', error: 'Unknown', message: 'Weird' });
  });
  it('works without an access token', async () => {
    const f = fakeFetch([{ body: { data: [{ status: 'ok', id: 'a' }] } }]);
    await new ExpoPushSender(undefined, f.fetch).send([msg(1)]);
    expect((f.calls[0]?.init?.headers as Record<string, string>).authorization).toBeUndefined();
  });
});

describe('FakePushSender', () => {
  it('records messages and simulates unregistered devices', async () => {
    const push = new FakePushSender();
    const tickets = await push.send([msg(1), { ...msg(2), to: 'ExponentPushToken[unregistered]' }]);
    expect(tickets[0]).toEqual({ status: 'ok', id: 'fake-ticket-1' });
    expect(tickets[1]).toMatchObject({ status: 'error', error: 'DeviceNotRegistered' });
    expect(push.sent).toHaveLength(1);
  });
  it('validates token format', () => {
    expect(isExpoPushToken('ExponentPushToken[abc-_1]')).toBe(true);
    expect(isExpoPushToken('ExpoPushToken[abc]')).toBe(true);
    expect(isExpoPushToken('fcm:abc')).toBe(false);
  });
});
