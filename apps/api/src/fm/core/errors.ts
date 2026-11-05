export const ERROR_STATUS = {
  NOT_FOUND: 404,
  FORBIDDEN: 403,
  EXISTS: 409,
  ETAG_MISMATCH: 412,
  NOT_EMPTY: 409,
  NOT_A_DIR: 400,
  IS_A_DIR: 400,
  INVALID: 400,
  TOO_LARGE: 413,
  UNSUPPORTED: 405,
  RANGE: 416,
} as const;

export type FmErrorCode = keyof typeof ERROR_STATUS;

export class FmError extends Error {
  readonly code: FmErrorCode;

  constructor(code: FmErrorCode, message: string) {
    super(message);
    this.name = "FmError";
    this.code = code;
  }

  get status(): (typeof ERROR_STATUS)[FmErrorCode] {
    return ERROR_STATUS[this.code];
  }
}

export function isFmError(err: unknown, code?: FmErrorCode): err is FmError {
  return err instanceof FmError && (code === undefined || err.code === code);
}
