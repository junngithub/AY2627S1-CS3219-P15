export type EmailConfiguration =
  | { provider: "development" }
  | { provider: "disabled" }
  | { provider: "ses"; region: string; fromAddress: string };

export function readEmailConfiguration(env: NodeJS.ProcessEnv): EmailConfiguration {
  const local = ["development", "test"].includes(env.NODE_ENV ?? "development");
  const provider = env.EMAIL_PROVIDER?.trim() || (local ? "development" : "disabled");
  if (provider === "development") {
    if (!local) throw new Error("Development email logging is allowed only in development or test.");
    return { provider };
  }
  if (provider === "disabled") return { provider };
  if (provider !== "ses") throw new Error("EMAIL_PROVIDER must be development, disabled or ses.");
  const region = env.AWS_REGION?.trim();
  if (!region || !/^[a-z]{2}(?:-[a-z]+)+-\d+$/.test(region)) {
    throw new Error("AWS_REGION must specify the region containing the verified SES identity.");
  }
  const fromAddress = env.SES_FROM_EMAIL?.trim();
  // Accept one bare ASCII mailbox, not a display name, list or injected header.
  if (!fromAddress || !/^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?\.[A-Za-z]{2,}$/.test(fromAddress)) {
    throw new Error("SES_FROM_EMAIL must be one verified email address without a display name.");
  }
  return { provider, region, fromAddress };
}
