import { applyDecorators } from '@nestjs/common';
import { ApiBody, ApiQuery, ApiResponse } from '@nestjs/swagger';
import { z } from 'zod';

type JsonSchema = Record<string, unknown>;

/** Convert a shared Zod schema to an OpenAPI-compatible JSON schema (draft 2020-12 subset). */
export function toOpenApiSchema(schema: z.ZodType, io: 'input' | 'output' = 'output'): JsonSchema {
  const json = z.toJSONSchema(schema, {
    target: 'openapi-3.0',
    io,
    unrepresentable: 'any',
  }) as JsonSchema;
  delete json.$schema;
  return json;
}

export function ApiZodBody(schema: z.ZodType): MethodDecorator & ClassDecorator {
  return applyDecorators(ApiBody({ schema: toOpenApiSchema(schema, 'input') }));
}

export function ApiZodResponse(
  status: number,
  schema: z.ZodType,
  description?: string,
): MethodDecorator & ClassDecorator {
  return applyDecorators(
    ApiResponse({ status, description: description ?? 'Success', schema: toOpenApiSchema(schema) }),
  );
}

/** Documents each property of an object schema as a query parameter. */
export function ApiZodQuery(schema: z.ZodObject): MethodDecorator & ClassDecorator {
  const json = toOpenApiSchema(schema, 'input');
  const properties = (json.properties ?? {}) as Record<string, JsonSchema>;
  const required = new Set((json.required as string[] | undefined) ?? []);
  return applyDecorators(
    ...Object.entries(properties).map(([name, prop]) =>
      ApiQuery({ name, required: required.has(name), schema: prop }),
    ),
  );
}
