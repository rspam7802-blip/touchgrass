import { describe, expect, it } from 'vitest';
import { PaginationQuery } from '@touchgrass/shared';
import { z, ZodError } from 'zod';
import { ZodPipe } from './zod.js';
import {
  ApiZodBody,
  ApiZodQuery,
  ApiZodResponse,
  toOpenApiSchema,
} from '../openapi/zod-openapi.js';

describe('ZodPipe', () => {
  it('parses and coerces', () => {
    expect(new ZodPipe(PaginationQuery).transform({ limit: '5' }, { type: 'query' })).toEqual({
      limit: 5,
    });
  });
  it('throws ZodError on invalid input', () => {
    expect(() => new ZodPipe(PaginationQuery).transform({ limit: 0 }, { type: 'query' })).toThrow(
      ZodError,
    );
  });
});

describe('zod → openapi', () => {
  it('converts schemas without $schema', () => {
    const json = toOpenApiSchema(z.object({ a: z.string() }));
    expect(json.$schema).toBeUndefined();
    expect(json.type).toBe('object');
  });
  it('builds decorators', () => {
    expect(typeof ApiZodBody(z.object({ a: z.string() }))).toBe('function');
    expect(typeof ApiZodResponse(200, z.object({ a: z.string() }))).toBe('function');
    expect(typeof ApiZodQuery(PaginationQuery)).toBe('function');
  });
});
