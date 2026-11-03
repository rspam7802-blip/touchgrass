import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { CursorError, decodeCursor, encodeCursor, TimeIdCursor } from './cursor';

describe('cursor', () => {
  it('round-trips payloads including unicode', () => {
    const payload = { t: '2026-10-31T10:00:00.000Z', id: '0192f3a4-5b6c-7d8e-9f01-23456789abcd' };
    expect(decodeCursor(encodeCursor(payload), TimeIdCursor)).toEqual(payload);
    const schema = z.object({ s: z.string() });
    for (const s of ['a', 'ab', 'abc', 'చాయ్ ☕', '']) {
      expect(decodeCursor(encodeCursor({ s }), schema)).toEqual({ s });
    }
  });
  it('produces url-safe output', () => {
    expect(encodeCursor({ s: '>>>???' })).toMatch(/^[A-Za-z0-9_-]+$/);
  });
  it('rejects tampered, malformed or schema-invalid cursors', () => {
    expect(() => decodeCursor('!!!', TimeIdCursor)).toThrow(CursorError);
    expect(() => decodeCursor('a', TimeIdCursor)).toThrow(CursorError);
    expect(() => decodeCursor(encodeCursor({ t: 'x', id: 'y' }), TimeIdCursor)).toThrow(
      CursorError,
    );
    expect(() => decodeCursor('bm90IGpzb24', TimeIdCursor)).toThrow(CursorError);
  });
});
