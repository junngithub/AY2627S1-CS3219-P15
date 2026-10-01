type StatusUser = {
  accessStatus: "ACTIVE" | "SUSPENDED";
  emailVerifiedAt: Date | null;
  telegramVerifiedAt: Date | null;
  scheduledDeletionAt: Date | null;
};

export function accountStatus(user: StatusUser): "Created" | "Verified" | "Suspended" {
  if (user.accessStatus === "SUSPENDED") return "Suspended";
  if (user.emailVerifiedAt && user.telegramVerifiedAt) return "Verified";
  return "Created";
}

export function accountNextSteps(user: StatusUser): string[] {
  if (user.accessStatus === "SUSPENDED") {
    return ["Contact an administrator about the account suspension"];
  }

  const steps: string[] = [];
  if (!user.emailVerifiedAt) steps.push("Verify your NUS email address");
  if (!user.telegramVerifiedAt) steps.push("Verify your Telegram handle");
  if (user.scheduledDeletionAt) steps.push("Log in to cancel pending account deletion");
  return steps;
}
