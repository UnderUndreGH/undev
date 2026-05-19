import type { Request } from "express";
import { AppError } from "./app-error.js";

/**
 * Extracts the authenticated operator ID from the request.
 * Set by requireAuth middleware as (req as Request & { userId: string }).userId.
 * Throws AppError.unauthorized if userId is missing — prevents silent identity loss.
 */
export function getOperatorId(req: Request & { userId?: string }): string {
  if (!req.userId || typeof req.userId !== "string") {
    throw AppError.unauthorized("No operator identity attached to request");
  }
  return req.userId;
}
