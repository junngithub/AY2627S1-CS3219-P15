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
    return ["CONTACT_ADMIN"];
  }

  const steps: string[] = [];
  if (!user.emailVerifiedAt) steps.push("VERIFY_EMAIL");
  if (!user.telegramVerifiedAt) steps.push("VERIFY_TELEGRAM");
  if (user.scheduledDeletionAt) steps.push("CANCEL_PENDING_DELETION");
  return steps;
}
