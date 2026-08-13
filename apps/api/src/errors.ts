import { ZodError } from "zod";

export class ApiError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: string,
    message: string,
    readonly retryable = false,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "ApiError";
  }
}

export function safeErrorMessage(error: unknown): string {
  if (error instanceof ApiError || error instanceof Error) return error.message.slice(0, 1_000);
  return "Unknown service error";
}

export function errorCode(error: unknown): string {
  if (error instanceof ApiError) return error.code;
  if (error instanceof ZodError) return "VALIDATION_FAILED";
  return "PIPELINE_FAILED";
}

export function isRetryable(error: unknown): boolean {
  return error instanceof ApiError && error.retryable;
}
