export type ErrorCode =
  | "BAD_REQUEST"
  | "VALIDATION_FAILED"
  | "UNAUTHENTICATED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "CONFLICT"
  | "INVALID_TRANSITION"
  | "RATE_LIMITED"
  | "PAYLOAD_TOO_LARGE"
  | "UNSUPPORTED_MEDIA_TYPE"
  | "NOT_CONNECTED"
  | "INTERNAL";

const STATUS: Record<ErrorCode, number> = {
  BAD_REQUEST: 400,
  VALIDATION_FAILED: 422,
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  INVALID_TRANSITION: 409,
  RATE_LIMITED: 429,
  PAYLOAD_TOO_LARGE: 413,
  UNSUPPORTED_MEDIA_TYPE: 415,
  NOT_CONNECTED: 503,
  INTERNAL: 500,
};

export class AppError extends Error {
  readonly status: number;
  constructor(
    readonly code: ErrorCode,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = "AppError";
    this.status = STATUS[code];
  }
}

export const notFound = (what = "Resource") => new AppError("NOT_FOUND", `${what} not found`);
export const forbidden = (msg = "You do not have permission to perform this action") => new AppError("FORBIDDEN", msg);
export const conflict = (msg: string, details?: unknown) => new AppError("CONFLICT", msg, details);
export const badRequest = (msg: string, details?: unknown) => new AppError("BAD_REQUEST", msg, details);
