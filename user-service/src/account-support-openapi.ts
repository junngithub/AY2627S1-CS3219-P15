const errorContent = { "application/json": { schema: { $ref: "#/components/schemas/Error" } } };
const deliveryErrors = {
  "413": { description: "JSON body exceeds the service's 32 KiB limit", content: errorContent },
  "409": { description: "Support request conflicts with an existing Admin record", content: errorContent },
  "502": { description: "Invalid/unexpected Admin response or rejected intake request", content: errorContent },
  "503": { description: "Admin is unconfigured, unavailable or timed out; retry later", content: errorContent },
};
const timestamp = { type: "string", format: "date-time" };
const closedFields = { createdAt: timestamp, closedAt: { ...timestamp, nullable: true },
  closedByAdminId: { type: "string", nullable: true } };
export const accountSupportSchemas = {
  UserReportRecord: { type: "object", required: ["id", "reporterUserId", "reportedUserId", "comment", "status", "createdAt", "closedAt", "closedByAdminId"],
    properties: { id: { type: "string", format: "uuid" }, reporterUserId: { type: "string", format: "uuid" },
      reportedUserId: { type: "string", format: "uuid" }, comment: { type: "string", maxLength: 4000 },
      status: { type: "string", enum: ["open", "dismissed", "actioned"] }, ...closedFields } },
  SuspensionAppealRecord: { type: "object", required: ["id", "userId", "message", "status", "createdAt", "closedAt", "closedByAdminId"],
    properties: { id: { type: "string", format: "uuid" }, userId: { type: "string", format: "uuid" },
      message: { type: "string", maxLength: 4000 }, status: { type: "string", enum: ["open", "rejected", "reinstated"] }, ...closedFields } },
};
export const accountSupportPaths = {
  "/api/v1/user/reports": { post: {
    tags: ["Account support"], summary: "Report another user to Admin",
    description: "Requires a real active bearer session. Reporter UUID comes from the session, never the body. Rejects self-reports and missing/deletion-expired targets. Calls private Admin intake and returns its stored record. Reporting does not suspend anyone. Admin deduplicates an open reporter/target pair, preserving its original comment. Responses are no-store.",
    security: [{ bearerAuth: [] }],
    requestBody: { required: true, content: { "application/json": { schema: {
      type: "object", required: ["reportedUserId", "comment"], properties: { reportedUserId: { type: "string", format: "uuid" },
        comment: { type: "string", minLength: 1, maxLength: 4000, description: "Trimmed issue description" } },
    } } } },
    responses: { ...deliveryErrors,
      "201": { description: "Admin's stored report; repeated open-pair requests return the existing row", content: {
        "application/json": { schema: { $ref: "#/components/schemas/UserReportRecord" } } } },
      "400": { description: "Invalid UUID, blank/oversized comment, or SELF_REPORT", content: errorContent },
      "401": { $ref: "#/components/responses/Unauthorized" }, "404": { description: "Reported user not found", content: errorContent },
    },
  } },
  "/api/v1/user/appeals": { post: {
    tags: ["Account support"], summary: "Appeal suspension without creating a session",
    description: "Public credential-checking endpoint: correct password and suspended account required. Locked or deletion-expired accounts are rejected. Does not sign in, reinstate or forward the password. Admin owns one open appeal per user; repeats return the existing record and original message, not an extra appeal. The process-local limiter allows ten attempts per normalized-email hash per fifteen minutes; gateway distributed throttling is still required. No-store responses. This route must be explicitly public at the gateway before deployment.",
    security: [], requestBody: { required: true, content: { "application/json": { schema: {
      type: "object", required: ["email", "password", "message"], properties: {
        email: { type: "string", format: "email", maxLength: 320 }, password: { type: "string", format: "password", writeOnly: true },
        message: { type: "string", minLength: 1, maxLength: 4000, description: "Trimmed appeal message" },
      },
    } } } }, responses: { ...deliveryErrors,
      "201": { description: "Admin's stored open appeal; no session issued", content: {
        "application/json": { schema: { $ref: "#/components/schemas/SuspensionAppealRecord" } } } },
      "400": { description: "Blank or oversized appeal message", content: errorContent },
      "401": { description: "Generic INVALID_CREDENTIALS for unknown user, wrong password, lockout or expired deletion", content: errorContent },
      "409": { description: "ACCOUNT_NOT_SUSPENDED after successful credential check, or Admin conflict", content: errorContent },
      "429": { description: "TOO_MANY_APPEAL_ATTEMPTS; wait before retrying", content: errorContent },
    },
  } },
};
