/** API error codes and their HTTP statuses (SPEC §12.9). Messages live in the message catalog. */
export const ERROR_HTTP_STATUS = {
  BAD_REQUEST: 400,
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  ROLE_REQUIRED: 403,
  CSRF_INVALID: 403,
  NOT_FOUND: 404,
  INVALID_STATE_TRANSITION: 409,
  QUOTE_VERSION_STALE: 409,
  QUOTE_EXPIRED: 409,
  DATES_UNAVAILABLE: 409,
  BOOKING_CONFLICT: 409,
  CONFLICT: 409,
  VALIDATION_FAILED: 422,
  OUT_OF_SERVICE_AREA: 422,
  IDEMPOTENCY_KEY_REUSED: 422,
  OTP_INVALID: 422,
  RATE_LIMITED: 429,
  INTERNAL: 500,
  AI_UNAVAILABLE: 503,
} as const;

export type ErrorCode = keyof typeof ERROR_HTTP_STATUS;

export interface ApiErrorBody {
  error: {
    code: ErrorCode;
    message: string;
    details: Array<{ path?: string; code?: string; message?: string }>;
  };
}
