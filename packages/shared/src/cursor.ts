import { z } from 'zod';

/**
 * Opaque cursors for keyset pagination. A cursor encodes the sort key(s) of the last row
 * returned; it is never an offset. Encoding is base64url(JSON) so it works in Node, browsers and Hermes.
 */
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

function bytesToBase64Url(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i] ?? 0;
    const b1 = bytes[i + 1];
    const b2 = bytes[i + 2];
    const n = (b0 << 16) | ((b1 ?? 0) << 8) | (b2 ?? 0);
    out += ALPHABET.charAt((n >> 18) & 63) + ALPHABET.charAt((n >> 12) & 63);
    if (b1 !== undefined) out += ALPHABET.charAt((n >> 6) & 63);
    if (b2 !== undefined) out += ALPHABET.charAt(n & 63);
  }
  return out;
}

function base64UrlToBytes(input: string): Uint8Array {
  if (!/^[A-Za-z0-9_-]*$/.test(input) || input.length % 4 === 1) {
    throw new CursorError();
  }
  const bytes: number[] = [];
  for (let i = 0; i < input.length; i += 4) {
    const chunk = input.slice(i, i + 4);
    const values = Array.from({ length: chunk.length }, (_, j) =>
      ALPHABET.indexOf(chunk.charAt(j)),
    );
    const n =
      ((values[0] ?? 0) << 18) |
      ((values[1] ?? 0) << 12) |
      ((values[2] ?? 0) << 6) |
      (values[3] ?? 0);
    bytes.push((n >> 16) & 255);
    if (chunk.length > 2) bytes.push((n >> 8) & 255);
    if (chunk.length > 3) bytes.push(n & 255);
  }
  return Uint8Array.from(bytes);
}

export class CursorError extends Error {
  constructor() {
    super('Invalid pagination cursor');
    this.name = 'CursorError';
  }
}

export function encodeCursor(payload: unknown): string {
  return bytesToBase64Url(new TextEncoder().encode(JSON.stringify(payload)));
}

export function decodeCursor<T>(cursor: string, schema: z.ZodType<T>): T {
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(base64UrlToBytes(cursor)));
  } catch {
    throw new CursorError();
  }
  const result = schema.safeParse(parsed);
  if (!result.success) throw new CursorError();
  return result.data;
}

/** The standard (timestamp, id) keyset used by most lists. */
export const TimeIdCursor = z.object({ t: z.iso.datetime(), id: z.uuid() });
export type TimeIdCursor = z.infer<typeof TimeIdCursor>;
