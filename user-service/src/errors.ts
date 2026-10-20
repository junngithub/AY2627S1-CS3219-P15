import { NextFunction, Request, Response } from "express";

export class AppError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export function errorHandler(
  error: unknown,
  _request: Request,
  response: Response,
  _next: NextFunction,
): void {
  if (error instanceof AppError) {
    response.status(error.status).json({ error: error.message, code: error.code });
    return;
  }

  console.error(error);
  response.status(500).json({
    error: "An unexpected error occurred",
    code: "INTERNAL_ERROR",
  });
}
