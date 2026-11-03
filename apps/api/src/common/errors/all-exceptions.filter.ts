import {
  type ArgumentsHost,
  Catch,
  type ExceptionFilter,
  HttpException,
  Logger,
} from '@nestjs/common';
import { CursorError, type ErrorCode, errorEnvelope } from '@touchgrass/shared';
import type { Response } from 'express';
import { ZodError } from 'zod';
import { AppError } from './app-error.js';

const HTTP_TO_CODE: Record<number, ErrorCode> = {
  400: 'VALIDATION_FAILED',
  401: 'UNAUTHENTICATED',
  403: 'FORBIDDEN',
  404: 'NOT_FOUND',
  409: 'CONFLICT',
  413: 'PAYLOAD_TOO_LARGE',
  415: 'UNSUPPORTED_MEDIA_TYPE',
  429: 'RATE_LIMITED',
};

export interface MappedError {
  status: number;
  body: ReturnType<typeof errorEnvelope>;
}

/** Pure mapping so it can be unit tested without an HTTP context. Stack traces never reach the client. */
export function mapException(exception: unknown, exposeInternalMessage: boolean): MappedError {
  if (exception instanceof AppError) {
    return {
      status: exception.status,
      body: errorEnvelope(exception.code, exception.message, exception.details),
    };
  }
  if (exception instanceof ZodError) {
    const details = exception.issues.map((i) => ({
      path: i.path.join('.'),
      message: i.message,
      code: i.code,
    }));
    return {
      status: 400,
      body: errorEnvelope('VALIDATION_FAILED', 'Request validation failed', details),
    };
  }
  if (exception instanceof CursorError) {
    return { status: 400, body: errorEnvelope('INVALID_CURSOR', exception.message) };
  }
  if (exception instanceof HttpException) {
    const status = exception.getStatus();
    const code = HTTP_TO_CODE[status] ?? (status >= 500 ? 'INTERNAL' : 'VALIDATION_FAILED');
    return { status, body: errorEnvelope(code, exception.message) };
  }
  const message =
    exposeInternalMessage && exception instanceof Error
      ? exception.message
      : 'Internal server error';
  return { status: 500, body: errorEnvelope('INTERNAL', message) };
}

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('Exceptions');

  constructor(private readonly exposeInternalMessage: boolean) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const { status, body } = mapException(exception, this.exposeInternalMessage);
    if (status >= 500)
      this.logger.error(exception instanceof Error ? exception.stack : String(exception));
    if (host.getType() !== 'http') return;
    const res = host.switchToHttp().getResponse<Response>();
    if (res.headersSent) return;
    res.status(status).json(body);
  }
}
