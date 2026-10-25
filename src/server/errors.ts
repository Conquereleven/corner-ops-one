/** Application errors with user-safe messages. Technical details stay in server logs. */
export class AppError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code: string,
  ) {
    super(message);
    this.name = new.target.name;
  }
}

export class UnauthenticatedError extends AppError {
  constructor(message = "Your session has expired. Please sign in again.") {
    super(message, 401, "unauthenticated");
  }
}
export class ForbiddenError extends AppError {
  constructor(message = "You don't have permission to do that.") {
    super(message, 403, "forbidden");
  }
}
export class NotFoundError extends AppError {
  constructor(what = "Record") {
    super(`${what} not found`, 404, "not_found");
  }
}
export class ConflictError extends AppError {
  constructor(message: string) {
    super(message, 409, "conflict");
  }
}
export class NoOrganizationError extends AppError {
  constructor() {
    super("You are not a member of any organization yet.", 403, "no_organization");
  }
}
export class ServiceUnavailableError extends AppError {
  constructor(message = "The database is temporarily unavailable. Please try again shortly.") {
    super(message, 503, "unavailable");
  }
}
export class ConfigurationError extends AppError {
  constructor(message: string) {
    super(message, 500, "configuration");
  }
}

/** Translate Postgres / driver errors into application errors. */
export function fromDatabaseError(err: unknown): AppError | null {
  const e = err as { code?: string; errno?: string; message?: string };
  switch (e?.code) {
    case "23505":
      return new ConflictError("That record already exists.");
    case "23503":
      return new ConflictError("This change references a record that doesn't exist.");
    case "23514":
    case "22P02":
      return new ConflictError("That update isn't valid.");
    case "42501":
      return new ForbiddenError();
    case "P0002":
      return new NotFoundError();
    case "ECONNREFUSED":
    case "ENOTFOUND":
    case "ETIMEDOUT":
    case "CONNECT_TIMEOUT":
    case "57P01":
    case "57P03":
      return new ServiceUnavailableError();
    default:
      return null;
  }
}
