export type ErrorCode =
  | "validation"
  | "unauthorized"
  | "forbidden"
  | "not_found"
  | "conflict"
  | "rate_limited"
  | "provider_error"
  | "precondition_failed"
  | "internal"

const HTTP_STATUS: Record<ErrorCode, number> = {
  validation: 400,
  unauthorized: 401,
  forbidden: 403,
  not_found: 404,
  conflict: 409,
  rate_limited: 429,
  provider_error: 502,
  precondition_failed: 412,
  internal: 500,
}

export class AppError extends Error {
  readonly code: ErrorCode

  constructor(code: ErrorCode, message: string, cause?: unknown) {
    if (cause === undefined) {
      super(message)
    } else {
      super(message, { cause })
    }
    this.code = code
    this.name = "AppError"
  }
}

export function appError(code: ErrorCode, message: string, cause?: unknown): AppError {
  return new AppError(code, message, cause)
}

export function toHttpError(error: AppError): {
  status: number
  body: { error: { code: ErrorCode; message: string } }
} {
  return {
    status: HTTP_STATUS[error.code],
    body: { error: { code: error.code, message: error.message } },
  }
}
