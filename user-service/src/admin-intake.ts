import { AppError } from "./errors";
import { isUuid } from "./integration-access";

export type ReportInput = { reporterUserId: string; reportedUserId: string; comment: string };
export type AppealInput = { userId: string; message: string };
export type ReportRecord = { id: string; reporter_user_id: string; reported_user_id: string; comment: string;
  status: "open" | "dismissed" | "actioned"; created_at: string; closed_at: string | null; closed_by_admin_id: string | null };
export type AppealRecord = { id: string; user_id: string; message: string; status: "open" | "rejected" | "reinstated";
  created_at: string; closed_at: string | null; closed_by_admin_id: string | null };
export interface AdminIntake {
  report(input: ReportInput): Promise<ReportRecord>;
  appeal(input: AppealInput): Promise<AppealRecord>;
}

const invalidResponse = () => new AppError(502, "ADMIN_INVALID_RESPONSE", "Admin Service returned an invalid response");
const isText = (value: unknown, max: number) => typeof value === "string" && value.length > 0 && value.length <= max;
const isDate = (value: unknown) => typeof value === "string" && !Number.isNaN(Date.parse(value));

export function validateAdminBaseUrl(value: string): string {
  if (!value) return ""; // Other account operations remain usable when Admin is not configured.
  try {
    const url = new URL(value);
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.search || url.hash || url.pathname !== "/") throw new Error();
    return url.origin;
  } catch {
    throw new Error("ADMIN_SERVICE_BASE_URL must be an HTTP(S) origin without credentials, path, query or fragment");
  }
}

export class HttpAdminIntake implements AdminIntake {
  private readonly origin: string;
  constructor(baseUrl: string, private readonly timeoutMs = 5000, private readonly send: typeof fetch = fetch) {
    this.origin = validateAdminBaseUrl(baseUrl);
    if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 30_000) throw new Error("Invalid Admin request timeout");
  }

  private async post(path: string, payload: ReportInput | AppealInput): Promise<Record<string, unknown>> {
    if (!this.origin) throw new AppError(503, "ADMIN_NOT_CONFIGURED", "Account support is not configured");
    try {
      const response = await this.send(new URL(path, this.origin), {
        method: "POST", redirect: "error", signal: AbortSignal.timeout(this.timeoutMs),
        headers: { "content-type": "application/json", accept: "application/json" }, body: JSON.stringify(payload),
      });
      if (response.status !== 201) {
        await response.body?.cancel();
        if (response.status === 409) throw new AppError(409, "ADMIN_CONFLICT", "An account support request conflicts with an existing request");
        if (response.status >= 500 || response.status === 429) throw new AppError(503, "ADMIN_UNAVAILABLE", "Account support is temporarily unavailable");
        throw new AppError(502, "ADMIN_REQUEST_REJECTED", "Admin Service rejected the support request");
      }
      const reader = response.body?.getReader();
      if (!reader) throw invalidResponse();
      const chunks: Uint8Array[] = [];
      let bytes = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        bytes += value.byteLength;
        if (bytes > 32_768) { await reader.cancel(); throw invalidResponse(); }
        chunks.push(value);
      }
      let value: unknown;
      try { value = JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch { throw invalidResponse(); }
      if (!value || typeof value !== "object" || Array.isArray(value)) throw invalidResponse();
      const row = value as Record<string, unknown>;
      if (!isUuid(row.id) || !isDate(row.created_at) || (row.closed_at !== null && !isDate(row.closed_at))
        || (row.closed_by_admin_id !== null && !isText(row.closed_by_admin_id, 200))) throw invalidResponse();
      return row;
    } catch (error) {
      if (error instanceof AppError) throw error;
      // Do not log or return raw upstream errors, URLs, comments or credentials.
      throw new AppError(503, "ADMIN_UNAVAILABLE", "Account support is temporarily unavailable");
    }
  }

  async report(input: ReportInput): Promise<ReportRecord> {
    const row = await this.post("/api/v1/admin/reports", input);
    if (row.reporter_user_id !== input.reporterUserId || row.reported_user_id !== input.reportedUserId
      || !isText(row.comment, 4000) || typeof row.status !== "string" || !["open", "dismissed", "actioned"].includes(row.status)) throw invalidResponse();
    // Keep Admin's stored text on idempotent retries, but don't forward unknown fields.
    return { id: row.id, reporter_user_id: row.reporter_user_id, reported_user_id: row.reported_user_id,
      comment: row.comment, status: row.status, created_at: row.created_at, closed_at: row.closed_at,
      closed_by_admin_id: row.closed_by_admin_id } as ReportRecord;
  }

  async appeal(input: AppealInput): Promise<AppealRecord> {
    const row = await this.post("/api/v1/admin/appeals", input);
    if (row.user_id !== input.userId || !isText(row.message, 4000)
      || typeof row.status !== "string" || !["open", "rejected", "reinstated"].includes(row.status)) throw invalidResponse();
    return { id: row.id, user_id: row.user_id, message: row.message, status: row.status, created_at: row.created_at,
      closed_at: row.closed_at, closed_by_admin_id: row.closed_by_admin_id } as AppealRecord;
  }
}
