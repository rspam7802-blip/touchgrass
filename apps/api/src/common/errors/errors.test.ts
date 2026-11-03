import {
  BadRequestException,
  NotFoundException,
  PayloadTooLargeException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { CursorError } from '@touchgrass/shared';
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { AppError } from './app-error.js';
import { AllExceptionsFilter, mapException } from './all-exceptions.filter.js';
import type { ArgumentsHost } from '@nestjs/common';

describe('AppError', () => {
  it('carries code, status and details', () => {
    const err = AppError.conflict('taken', { field: 'x' });
    expect(err.status).toBe(409);
    expect(err.details).toEqual({ field: 'x' });
    expect(AppError.notFound('Event').message).toBe('Event not found');
    expect(AppError.forbidden().status).toBe(403);
  });
});

describe('mapException', () => {
  it('maps AppError', () => {
    expect(mapException(new AppError('RATE_LIMITED', 'slow'), false)).toEqual({
      status: 429,
      body: { error: { code: 'RATE_LIMITED', message: 'slow' } },
    });
  });
  it('maps ZodError to VALIDATION_FAILED with paths', () => {
    const result = z.object({ a: z.number() }).safeParse({ a: 'x' });
    const mapped = mapException(result.error, false);
    expect(mapped.status).toBe(400);
    expect(mapped.body.error.code).toBe('VALIDATION_FAILED');
    expect(mapped.body.error.details).toEqual([expect.objectContaining({ path: 'a' })]);
  });
  it('maps cursor and Nest HTTP exceptions', () => {
    expect(mapException(new CursorError(), false).body.error.code).toBe('INVALID_CURSOR');
    expect(mapException(new NotFoundException(), false).body.error.code).toBe('NOT_FOUND');
    expect(mapException(new PayloadTooLargeException(), false).body.error.code).toBe(
      'PAYLOAD_TOO_LARGE',
    );
    expect(mapException(new ServiceUnavailableException(), false).body.error.code).toBe('INTERNAL');
    expect(mapException(new BadRequestException(), false).status).toBe(400);
  });
  it('hides internal messages and stacks unless allowed', () => {
    expect(mapException(new Error('db password wrong'), false).body.error.message).toBe(
      'Internal server error',
    );
    expect(mapException(new Error('db password wrong'), true).body.error.message).toBe(
      'db password wrong',
    );
    expect(JSON.stringify(mapException(new Error('x'), true))).not.toContain('at ');
    expect(mapException('weird', true).status).toBe(500);
  });
});

describe('AllExceptionsFilter', () => {
  const host = (type: string, headersSent = false) => {
    const res = { headersSent, status: vi.fn().mockReturnThis(), json: vi.fn() };
    return {
      res,
      host: {
        getType: () => type,
        switchToHttp: () => ({ getResponse: () => res }),
      } as unknown as ArgumentsHost,
    };
  };
  it('writes the envelope for http', () => {
    const { res, host: h } = host('http');
    new AllExceptionsFilter(false).catch(AppError.notFound(), h);
    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith({
      error: { code: 'NOT_FOUND', message: 'Resource not found' },
    });
  });
  it('does nothing for non-http contexts or sent headers', () => {
    const ws = host('ws');
    new AllExceptionsFilter(false).catch(new Error('boom'), ws.host);
    expect(ws.res.status).not.toHaveBeenCalled();
    const sent = host('http', true);
    new AllExceptionsFilter(false).catch(AppError.notFound(), sent.host);
    expect(sent.res.json).not.toHaveBeenCalled();
  });
});
