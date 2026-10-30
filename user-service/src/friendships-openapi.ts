const bearer = [{ bearerAuth: [] }];
const errorSchema = { "application/json": { schema: { $ref: "#/components/schemas/Error" } } };
const errors = {
  "400": { description: "Invalid UUID, self-request, pagination or direction", content: errorSchema },
  "401": { $ref: "#/components/responses/Unauthorized" },
  "404": { description: "User unavailable, request missing, or caller is not its recipient", content: errorSchema },
  "409": { description: "Duplicate pending/accepted pair, request state conflict, or unavailable sender", content: errorSchema },
};
const pageParameters = [
  { name: "page", in: "query", schema: { type: "integer", minimum: 1, maximum: 100000, default: 1 } },
  { name: "pageSize", in: "query", schema: { type: "integer", minimum: 1, maximum: 100, default: 20 } },
];
const requestIdParameter = [{ name: "requestId", in: "path", required: true, schema: { type: "string", format: "uuid" } }];
const pageFields = {
  page: { type: "integer" }, pageSize: { type: "integer" }, total: { type: "integer" },
};
const policy = "Requires the account owner's real bearer session, an active account and no pending deletion. Completed email/Telegram verification is not an extra requirement. No order-participation check is performed. Caller identity is derived from the session, not request-body IDs. Responses contain no email, Telegram or credential fields and use Cache-Control: no-store.";

export const friendshipSchemas = {
  PublicFriend: {
    type: "object", required: ["id", "name"], additionalProperties: false,
    properties: { id: { type: "string", format: "uuid" }, name: { type: "string" } },
  },
  PendingFriendRequest: {
    type: "object", required: ["requestId", "status", "createdAt", "sender", "recipient"],
    properties: {
      requestId: { type: "string", format: "uuid" }, status: { type: "string", enum: ["pending"] },
      createdAt: { type: "string", format: "date-time" },
      sender: { $ref: "#/components/schemas/PublicFriend" }, recipient: { $ref: "#/components/schemas/PublicFriend" },
    },
  },
};

function responseAction(action: "accept" | "reject") {
  return {
    tags: ["Friendships"], summary: `${action === "accept" ? "Accept" : "Reject"} an incoming friend request`,
    description: `${policy} Only the recipient may respond (otherwise 404). Repeating the same action is idempotent; another terminal state returns 409. Accepting also requires an available sender. A new invitation after rejection/removal has a new UUID.`,
    security: bearer, parameters: requestIdParameter,
    responses: { ...errors, "200": { description: "Request updated, or same action already applied", content: {
      "application/json": { schema: { type: "object", required: ["requestId", "status", "changed"], properties: {
        requestId: { type: "string", format: "uuid" }, status: { type: "string", enum: [action === "accept" ? "accepted" : "rejected"] },
        changed: { type: "boolean" },
      } } },
    } } },
  };
}

export const friendshipPaths = {
  "/api/v1/user/friends/request": { post: {
    tags: ["Friendships"], summary: "Send a friend request", description: `${policy} Rejects self-requests, unavailable recipients and either direction of an existing pending/accepted pair. Crossed requests are not auto-accepted.`,
    security: bearer,
    requestBody: { required: true, content: { "application/json": { schema: {
      type: "object", required: ["targetUserId"], properties: { targetUserId: { type: "string", format: "uuid" } },
    } } } },
    responses: { ...errors, "201": { description: "Pending request created", content: { "application/json": { schema: {
      type: "object", required: ["requestId", "senderId", "recipientId", "status", "createdAt"], properties: {
        requestId: { type: "string", format: "uuid" }, senderId: { type: "string", format: "uuid" },
        recipientId: { type: "string", format: "uuid" }, status: { type: "string", enum: ["pending"] },
        createdAt: { type: "string", format: "date-time" },
      },
    } } } } },
  } },
  "/api/v1/user/friends/requests": { get: {
    tags: ["Friendships"], summary: "List your pending incoming or outgoing requests", description: `${policy} Unavailable counterpart accounts are excluded. Stable newest-first pagination.`,
    security: bearer, parameters: [...pageParameters,
      { name: "direction", in: "query", schema: { type: "string", enum: ["incoming", "outgoing"], default: "incoming" } }],
    responses: { "400": errors["400"], "401": errors["401"], "200": { description: "Pending requests", content: { "application/json": { schema: {
      type: "object", required: ["items", "page", "pageSize", "total"], properties: {
        ...pageFields, items: { type: "array", items: { $ref: "#/components/schemas/PendingFriendRequest" } },
      },
    } } } } },
  } },
  "/api/v1/user/friends": { get: {
    tags: ["Friendships"], summary: "List your accepted friends", description: `${policy} Returns only each friend's ID and name. Unavailable counterpart accounts are excluded. A single accepted row appears in both users' lists.`,
    security: bearer, parameters: pageParameters,
    responses: { "400": errors["400"], "401": errors["401"], "200": { description: "Friends", content: { "application/json": { schema: {
      type: "object", required: ["items", "page", "pageSize", "total"], properties: {
        ...pageFields, items: { type: "array", items: { $ref: "#/components/schemas/PublicFriend" } },
      },
    } } } } },
  } },
  "/api/v1/user/friends/{requestId}/accept": { post: responseAction("accept") },
  "/api/v1/user/friends/{requestId}/reject": { post: responseAction("reject") },
  "/api/v1/user/friends/{friendUserId}": { delete: {
    tags: ["Friendships"], summary: "Remove a friend for both users", description: `${policy} Idempotent: returns 204 even if no accepted friendship exists. Does not cancel pending requests. Removal of an unavailable peer is allowed.`,
    security: bearer,
    parameters: [{ name: "friendUserId", in: "path", required: true, schema: { type: "string", format: "uuid" } }],
    responses: { "400": errors["400"], "401": errors["401"], "204": { description: "No accepted friendship remains; no response body" } },
  } },
};
