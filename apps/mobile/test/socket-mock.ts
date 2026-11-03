type Listener = (...args: unknown[]) => void;

export interface EmittedEvent {
  event: string;
  payload: unknown;
}

/** In-memory stand-in for a socket.io client: records what the app emits, lets tests push server events. */
export class FakeSocket {
  readonly emitted: EmittedEvent[] = [];
  connected = true;
  private readonly listeners = new Map<string, Set<Listener>>();

  constructor(
    readonly url: string,
    readonly options: unknown,
  ) {}

  on(event: string, listener: Listener): this {
    const set = this.listeners.get(event) ?? new Set<Listener>();
    set.add(listener);
    this.listeners.set(event, set);
    return this;
  }

  off(event: string, listener: Listener): this {
    this.listeners.get(event)?.delete(listener);
    return this;
  }

  emit(event: string, ...args: unknown[]): this {
    const last = args[args.length - 1];
    const ack = typeof last === 'function' ? (last as Listener) : null;
    this.emitted.push({ event, payload: args[0] });
    if (ack) ack({ ok: true, data: { joined: true } });
    return this;
  }

  disconnect(): this {
    this.connected = false;
    return this;
  }

  /** Delivers a server event to the app's listeners. */
  serverPush(event: string, ...args: unknown[]): void {
    for (const l of [...(this.listeners.get(event) ?? [])]) l(...args);
  }
}

export const sockets: FakeSocket[] = [];

/** Latest live socket whose URL ends with the namespace (e.g. '/chat'). */
export function socketFor(namespace: string): FakeSocket | undefined {
  return [...sockets].reverse().find((s) => s.connected && s.url.endsWith(namespace));
}

export function resetSockets(): void {
  sockets.length = 0;
}

export const socketMock = {
  io: (url: string, options: unknown) => {
    const socket = new FakeSocket(url, options);
    sockets.push(socket);
    return socket;
  },
};
