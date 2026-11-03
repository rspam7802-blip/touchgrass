import { type PushMessage, PushSender, type PushTicket } from './push.port.js';

/** Records sent notifications. Tokens containing "unregistered" simulate DeviceNotRegistered. */
export class FakePushSender extends PushSender {
  readonly sent: PushMessage[] = [];
  private counter = 0;

  send(messages: PushMessage[]): Promise<PushTicket[]> {
    return Promise.resolve(
      messages.map((m): PushTicket => {
        if (m.to.includes('unregistered')) {
          return {
            status: 'error',
            error: 'DeviceNotRegistered',
            message: 'Device is not registered',
          };
        }
        this.sent.push(m);
        if (this.sent.length > 5000) this.sent.shift();
        this.counter += 1;
        return { status: 'ok', id: `fake-ticket-${this.counter}` };
      }),
    );
  }
}
