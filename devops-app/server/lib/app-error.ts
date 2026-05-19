/**
 * Project-wide AppError implementation.
 * Mandated by feature 013 and project standards.
 */
export class AppError extends Error {
  override readonly name = "AppError";

  constructor(
    public readonly code: string,
    message: string,
    public readonly status: number = 400,
    public readonly details?: any,
  ) {
    super(message);
    Object.setPrototypeOf(this, AppError.prototype);
  }

  static badRequest(message: string, details?: any) {
    return new AppError("bad_request", message, 400, details);
  }

  static unauthorized(message: string = "Unauthorized") {
    return new AppError("unauthorized", message, 401);
  }

  static forbidden(message: string = "Forbidden") {
    return new AppError("forbidden", message, 403);
  }

  static notFound(message: string = "Not found") {
    return new AppError("not_found", message, 404);
  }

  static internal(message: string = "Internal server error", details?: any) {
    return new AppError("internal_error", message, 500, details);
  }

  // Feature 013 specific factories
  static budgetExhausted(message: string = "Monthly token budget exhausted") {
    return new AppError("budget_exhausted", message, 402);
  }

  static killSwitchEngaged(message: string = "Global AI kill switch is engaged") {
    return new AppError("kill_switch_engaged", message, 503);
  }

  static abortedByTimeout(message: string = "Conversation aborted by timeout") {
    return new AppError("aborted_by_timeout", message, 408);
  }

  static masterKeyUnavailable(message: string = "Master key unavailable for decryption") {
    return new AppError("master_key_unavailable", message, 500);
  }
}
