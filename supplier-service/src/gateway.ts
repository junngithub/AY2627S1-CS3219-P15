import { NextFunction, Request, Response } from "express";

// Identity headers set by the API gateway after it calls User authorize.
// See deploy/charts/foc-gateway/values.yaml identityHeaders.

function header(req: Request, name: string): string | undefined {
  const value = req.header(name);
  if (value === undefined) return undefined;
  const trimmed = value.trim();
  return trimmed.length === 0 ? undefined : trimmed;
}

export function actorUserId(req: Request): string | undefined {
  return header(req, "x-user-id");
}

function requireUser(req: Request, res: Response): boolean {
  if (!header(req, "x-user-id")) {
    res.status(401).json({ error: "Sign in is required" });
    return false;
  }
  return true;
}

function isPermitted(req: Request): boolean {
  return header(req, "x-permitted-action")?.toLowerCase() === "true";
}

function denyUnlessPermitted(req: Request, res: Response): boolean {
  if (isPermitted(req)) return true;
  res.status(403).json({ error: "This account is not permitted to manage suppliers" });
  return false;
}

/** Logged-in account that is active and has verified email and Telegram. */
export function requirePermitted(req: Request, res: Response, next: NextFunction): void {
  if (!requireUser(req, res)) return;
  if (!denyUnlessPermitted(req, res)) return;
  next();
}

/** Logged-in admin who is also active, with verified email and Telegram. */
export function requireAdmin(req: Request, res: Response, next: NextFunction): void {
  if (!requireUser(req, res)) return;
  if (header(req, "x-is-admin")?.toLowerCase() !== "true") {
    res.status(403).json({ error: "Admin access is required" });
    return;
  }
  if (!denyUnlessPermitted(req, res)) return;
  next();
}
