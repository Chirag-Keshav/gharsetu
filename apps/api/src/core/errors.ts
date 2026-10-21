import type { ErrorCode } from '@propcare/shared';

export interface ErrorDetail {
  path?: string;
  code?: string;
  message?: string;
}

/** Business error with a stable code; the exception filter turns it into the SPEC §12.9 shape. */
export class AppError extends Error {
  constructor(
    public readonly code: ErrorCode,
    public readonly details: ErrorDetail[] = [],
    message?: string,
  ) {
    super(message ?? code);
  }
}

export const notFound = () => new AppError('NOT_FOUND');
export const forbidden = (code?: string) => new AppError('FORBIDDEN', code ? [{ code }] : []);
export const invalidTransition = (from: string | null, to: string) =>
  new AppError('INVALID_STATE_TRANSITION', [{ code: `${from ?? 'NEW'}->${to}` }]);
export const validation = (...details: ErrorDetail[]) => new AppError('VALIDATION_FAILED', details);
export const conflict = (code?: string) => new AppError('CONFLICT', code ? [{ code }] : []);

/** Throws INVALID_STATE_TRANSITION when a conditional `updateMany` matched no row (lost a race). */
export function assertUpdated(result: { count: number }, from: string | null, to: string): void {
  if (result.count !== 1) throw invalidTransition(from, to);
}
