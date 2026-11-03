// Errors the HTTP layer turns into status codes with human sentences (SPEC §6.7: 409 + 人話).

export class ConflictError extends Error {
  readonly status = 409;
  readonly code: string;

  constructor(message: string, code = 'conflict') {
    super(message);
    this.name = 'ConflictError';
    this.code = code;
  }
}

export class NotFoundError extends Error {
  readonly status = 404;
  readonly code: string = 'not_found';

  constructor(message: string) {
    super(message);
    this.name = 'NotFoundError';
  }
}

export class BadRequestError extends Error {
  readonly status = 400;
  readonly code: string;

  constructor(message: string, code = 'bad_request') {
    super(message);
    this.name = 'BadRequestError';
    this.code = code;
  }
}

export function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
