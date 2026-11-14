import type { ErrorCode } from '@stockwise/shared';

const STATUS: Record<ErrorCode, number> = {
  INVALID_INPUT: 400,
  IDEMPOTENCY_KEY_REQUIRED: 400,
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  HOTEL_NOT_ALLOWED: 403,
  DEVICE_NOT_ENROLLED: 403,
  ACCOUNT_LOCKED: 423,
  INVALID_ROOM_OR_PRODUCT: 404,
  NOT_FOUND: 404,
  INSUFFICIENT_STOCK: 409,
  STALE_COUNT_SNAPSHOT: 409,
  TRANSFER_CONFLICT: 409,
  IDEMPOTENCY_CONFLICT: 409,
  PROPOSAL_EXPIRED: 422,
  UNSUPPORTED_AUDIO: 422,
  RATE_LIMITED: 429,
  TEMPORARY_UNAVAILABLE: 503,
  VOICE_DISABLED: 503,
  BUDGET_EXCEEDED: 503,
};

export class AppError extends Error {
  readonly status: number;
  constructor(readonly code: ErrorCode, message: string, readonly details?: unknown) {
    super(message);
    this.status = STATUS[code];
  }
}

export const err = (code: ErrorCode, message: string, details?: unknown) => new AppError(code, message, details);
