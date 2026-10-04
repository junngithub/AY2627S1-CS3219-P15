type AuthorizedUser = {
  id: string;
  role: "USER" | "ADMIN";
  accessStatus: "ACTIVE" | "SUSPENDED";
  emailVerifiedAt: Date | null;
  telegramVerifiedAt: Date | null;
};

export type AuthorizationResult = {
  authenticated: true;
  userId: string;
  isAdmin: boolean;
  permittedAction: boolean;
};

export function authorizationResult(user: AuthorizedUser): AuthorizationResult {
  return {
    authenticated: true,
    userId: user.id,
    isAdmin: user.role === "ADMIN",
    permittedAction:
      user.accessStatus === "ACTIVE" &&
      user.emailVerifiedAt !== null &&
      user.telegramVerifiedAt !== null,
  };
}

// The API gateway reads only the status and headers of the authorize response
// and copies these headers onto the request it forwards (infra ADR-0007).
// Names must match identityHeaders in deploy/charts/foc-gateway/values.yaml.
export function identityHeaders(result: AuthorizationResult): Record<string, string> {
  return {
    "x-user-id": result.userId,
    "x-is-admin": String(result.isAdmin),
    "x-permitted-action": String(result.permittedAction),
  };
}
