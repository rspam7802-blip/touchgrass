import { describe, expect, it } from 'vitest';
import { ERROR_HTTP_STATUS, ErrorCode, errorEnvelope, isErrorEnvelope } from './errors';

describe('errors', () => {
  it('maps every code to an HTTP status', () => {
    for (const code of ErrorCode.options) {
      expect(ERROR_HTTP_STATUS[code]).toBeGreaterThanOrEqual(400);
    }
  });
  it('builds envelopes with and without details', () => {
    expect(errorEnvelope('NOT_FOUND', 'nope')).toEqual({
      error: { code: 'NOT_FOUND', message: 'nope' },
    });
    const withDetails = errorEnvelope('VALIDATION_FAILED', 'bad', [{ path: 'x' }]);
    expect(withDetails.error.details).toEqual([{ path: 'x' }]);
    expect(isErrorEnvelope(withDetails)).toBe(true);
    expect(isErrorEnvelope({ error: { code: 'NOPE', message: 'x' } })).toBe(false);
  });
});
