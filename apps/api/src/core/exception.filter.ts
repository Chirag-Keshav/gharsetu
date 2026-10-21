import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  type ApiErrorBody,
  brandFromEnv,
  ERROR_HTTP_STATUS,
  type ErrorCode,
  errorMessages,
  interpolate,
} from '@propcare/shared';
import type { Response } from 'express';
import { ZodError } from 'zod';
import { AppError, type ErrorDetail } from './errors';
import { errorFields, log } from './logger';
import { pgErrorCode } from './prisma.service';

const brand = brandFromEnv(process.env);

export function errorBody(code: ErrorCode, details: ErrorDetail[] = []): ApiErrorBody {
  return { error: { code, message: interpolate(errorMessages[code], { productName: brand.productName }), details } };
}

function fromHttpStatus(status: number): ErrorCode {
  switch (status) {
    case 400:
    case 413:
    case 415:
      return 'BAD_REQUEST';
    case 401:
      return 'UNAUTHENTICATED';
    case 403:
      return 'FORBIDDEN';
    case 404:
      return 'NOT_FOUND';
    case 409:
      return 'CONFLICT';
    case 422:
      return 'VALIDATION_FAILED';
    case 429:
      return 'RATE_LIMITED';
    default:
      return 'INTERNAL';
  }
}

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const res = host.switchToHttp().getResponse<Response>();
    let code: ErrorCode = 'INTERNAL';
    let details: ErrorDetail[] = [];

    if (exception instanceof AppError) {
      code = exception.code;
      details = exception.details;
    } else if (exception instanceof ZodError) {
      code = 'VALIDATION_FAILED';
      details = exception.issues.slice(0, 50).map((i) => ({ path: i.path.join('.'), code: i.code, message: i.message }));
    } else if (exception instanceof HttpException) {
      code = fromHttpStatus(exception.getStatus());
    } else if (exception instanceof Prisma.PrismaClientKnownRequestError && exception.code === 'P2025') {
      code = 'NOT_FOUND';
    } else if (exception instanceof Prisma.PrismaClientKnownRequestError && exception.code === 'P2002') {
      code = 'CONFLICT';
    } else if (pgErrorCode(exception) === 'P0001') {
      // A database invariant (immutability, append-only, role exclusivity) rejected the write.
      code = 'CONFLICT';
      details = [{ code: 'DB_INVARIANT' }];
    } else if (pgErrorCode(exception) === '23P01') {
      code = 'DATES_UNAVAILABLE';
    }

    const status = ERROR_HTTP_STATUS[code] ?? HttpStatus.INTERNAL_SERVER_ERROR;
    if (status >= 500) log.error('unhandled_error', errorFields(exception));
    if (!res.headersSent) res.status(status).json(errorBody(code, details));
  }
}
