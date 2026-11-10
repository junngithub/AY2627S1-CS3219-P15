# AI Assistance Disclosure
# Tool: Cursor (Auto), date: 2026-11-01
# Scope: Implementation assistance for the k6 peak/soak script under author-fixed load-test design.
# Author review: Varun Sivakumar generated ideas, designed implementation, validated correctness, edited where needed, and verified behavior/tests.

// Backend load. Hits Order directly with the gateway identity headers.
// Order then calls User, Supplier, Credit, and, on escalate, Admin.
//
//   k6 run load-test/k6/load.js
//   k6 run -e PROFILE=soak -e VUS=30 -e DURATION=30s load-test/k6/load.js
//
// VUS must match setup/seed-users.mjs. Every seeded user can request and deliver;
// each iteration picks a role with REQUEST_PROBABILITY (default 0.4).
// Peak creates are gated separately so dual-role does not 3× write volume vs the
// old fixed requester roster (~REQUEST_PROBABILITY × VUS × MAX_ORDERS).
// PROFILE=peak (default): ramping-vus warm → peak hold → cool. PROFILE=soak: flat DURATION.
//
// Metrics cardinality (Prometheus / Grafana Cloud):
// Paths like /orders/${id}/accept would otherwise make one series per order via the
// default `url` (and default `name`=URL) tags. Fix: set tags.name to a stable endpoint
// id (k6 then also sets `url` to it); `url` is left out of systemTags as well.

import encoding from "k6/encoding";
import exec from "k6/execution";
import http from "k6/http";
import { check, sleep } from "k6";
import { SharedArray } from "k6/data";

const total = intEnv("VUS", 9600);
const profile = String(__ENV.PROFILE || "peak").toLowerCase();
// Chance this iteration acts as requester (else courier). Matches product: anyone can do both.
const requestProbability = Number(__ENV.REQUEST_PROBABILITY || __ENV.REQUESTER_SHARE || 0.4);
// On a deliver iteration, P(browse pool + maybe accept). Real couriers do not
// refresh/accept every second; 1.0 caused empty-pool read storms.
const courierBrowseProbability = Number(__ENV.COURIER_BROWSE_PROBABILITY || 0.2);
const orderUrl = __ENV.ORDER_URL || "http://localhost:8083";
const pickupId = __ENV.PICKUP_ID || "2";
const dropoffId = Number(__ENV.DROPOFF_ID || 1);
const escalateEvery = intEnv("ESCALATE_EVERY", 20);
const think = Number(__ENV.THINK_SECONDS || 1);
// Peak create shape: ~requestProbability of VUs place orders; among creators,
// ORDER_COUNT_WEIGHTS picks 1..MAX (NUS-skewed: most 1–2, thin tail to 5).
// 9600 VUs ≈ 2× peak headcount.
const maxOrdersPerRequester = intEnv("MAX_ORDERS_PER_REQUESTER", 5);
// Weights for placing 1, 2, …, max orders (comma-separated). Default E[n] ≈ 1.88.
const orderCountWeights = parseWeights(
  __ENV.ORDER_COUNT_WEIGHTS || "50,25,15,7,3",
  maxOrdersPerRequester,
);
// Spread each VU's creates uniformly over this window from VU start (not all at t≈0).
// Peak default 4m so creates finish before cool-down (close drain), not into it.
const createSpreadSeconds = intEnv(
  "CREATE_SPREAD_SECONDS",
  profile === "peak" ? 240 : 20,
);
// Must match trafficScenario peak stages before cool-down (2+2+2+4)m.
const peakBusyEndsMs = (2 + 2 + 2 + 4) * 60 * 1000;

// One user per element: SharedArray re-parses an element on every access, so a
// single element holding every user would parse the whole file each iteration.
const users = new SharedArray("users", () => {
  const data = JSON.parse(open("../data/users.json"));
  if (Array.isArray(data.users) && data.users.length > 0) {
    return data.users;
  }
  return [...data.requesters, ...data.couriers];
});

const photo = encoding.b64decode(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII=",
);

if (users.length < total) {
  throw new Error("users.json is smaller than this VUS. Re-run setup/seed-users.mjs with the same VUS.");
}
if (!(requestProbability > 0) || !(requestProbability < 1)) {
  throw new Error("REQUEST_PROBABILITY must be between 0 and 1");
}
if (!(courierBrowseProbability > 0) || courierBrowseProbability > 1) {
  throw new Error("COURIER_BROWSE_PROBABILITY must be in (0, 1]");
}
if (profile !== "peak" && profile !== "soak") {
  throw new Error("PROFILE must be peak or soak");
}
// Per-VU state (each VU has its own JS runtime).
const openOrders = [];
let createdCount = 0;
let createAttempts = 0;
// Once per VU: ~requestProbability create at all; else weighted 1..max.
// Each planned create gets a random due time in [vuStart, vuStart+spread].
const peakCreateBudget = drawPeakCreateBudget();
const vuStartedAt = Date.now();
const createDueAt = planCreateTimes(peakCreateBudget, vuStartedAt, createSpreadSeconds * 1000);
// Small retry allowance only — unlimited retries on failure starve Order (create death spiral).
const maxCreateAttempts = peakCreateBudget > 0 ? peakCreateBudget + 3 : 0;

function parseWeights(raw, maxOrders) {
  const parts = String(raw)
    .split(",")
    .map((part) => Number(part.trim()));
  if (parts.length !== maxOrders || parts.some((weight) => !(weight >= 0) || Number.isNaN(weight))) {
    throw new Error(
      `ORDER_COUNT_WEIGHTS must be ${maxOrders} non-negative numbers (for 1..${maxOrders} orders)`,
    );
  }
  const totalWeight = parts.reduce((sum, weight) => sum + weight, 0);
  if (!(totalWeight > 0)) {
    throw new Error("ORDER_COUNT_WEIGHTS must sum to a positive number");
  }
  return parts;
}

function drawPeakCreateBudget() {
  if (Math.random() >= requestProbability) {
    return 0;
  }
  let cursor = Math.random() * orderCountWeights.reduce((sum, weight) => sum + weight, 0);
  for (let index = 0; index < orderCountWeights.length; index += 1) {
    cursor -= orderCountWeights[index];
    if (cursor < 0) {
      return index + 1;
    }
  }
  return maxOrdersPerRequester;
}

function planCreateTimes(budget, startedAt, spreadMs) {
  const times = [];
  for (let i = 0; i < budget; i += 1) {
    times.push(startedAt + Math.floor(Math.random() * (spreadMs + 1)));
  }
  times.sort((left, right) => left - right);
  return times;
}

function trafficScenario() {
  if (profile === "soak") {
    return {
      executor: "constant-vus",
      vus: total,
      duration: __ENV.DURATION || "10m",
      exec: "traffic",
    };
  }
  // Compressed peak: warm → climb → hold → close-drain at half → ramp to 0 (~15m).
  const peak = total;
  const quarter = Math.max(1, Math.round(peak * 0.25));
  const half = Math.max(1, Math.round(peak * 0.5));
  return {
    executor: "ramping-vus",
    startVUs: 0,
    stages: [
      { duration: "2m", target: quarter },
      { duration: "2m", target: half },
      { duration: "2m", target: peak },
      { duration: "4m", target: peak },
      { duration: "3m", target: half },
      { duration: "2m", target: 0 },
    ],
    gracefulRampDown: "1m",
    exec: "traffic",
  };
}

export const options = {
  // systemTags only lists built-in tags. Custom `op` still comes from request tags.
  // Must not include `url` — that label keeps the full path with order UUIDs.
  systemTags: ["status", "method", "name", "expected_response", "scenario", "group", "check"],
  scenarios: {
    traffic: trafficScenario(),
  },
  thresholds: {
    "http_req_failed{op:create}": ["rate<0.05"],
    "http_req_failed{op:read}": ["rate<0.05"],
    "http_req_failed{op:fulfill}": ["rate<0.05"],
    "http_req_failed{op:close}": ["rate<0.05"],
  },
};

export function traffic() {
  const userId = users[(__VU - 1) % users.length].id;
  // Always advance own open orders so courier iterations do not strand them.
  pollAndCloseOwn(userId);
  // After peak hold: only close/poll so acknowledges are not racing create/browse cool-down.
  if (inCloseDrain()) {
    sleep(think);
    return;
  }
  if (Math.random() < requestProbability) {
    maybeCreate(userId);
    requesterReads(userId);
  } else {
    courier(userId);
  }
  sleep(think);
}

function inCloseDrain() {
  return profile === "peak" && exec.instance.currentTestRunDuration >= peakBusyEndsMs;
}

function maybeCreate(userId) {
  if (peakCreateBudget === 0) {
    return;
  }
  if (inCloseDrain()) {
    return;
  }
  if (createdCount >= peakCreateBudget || createAttempts >= maxCreateAttempts) {
    return;
  }
  if (openOrders.length >= peakCreateBudget) {
    return;
  }
  // Wait until this create's scheduled time; retries stay on the same slot after failures.
  if (Date.now() < createDueAt[createdCount]) {
    return;
  }
  createAttempts += 1;
  const created = createOrder(userId);
  if (created) {
    openOrders.push(created);
    createdCount += 1;
  }
}

function pollAndCloseOwn(userId) {
  for (let index = openOrders.length - 1; index >= 0; index -= 1) {
    const status = orderStatus(userId, openOrders[index]);
    if (status === "DELIVERED") {
      // Keep the id if close fails so the next iteration can retry (cool-down drain).
      if (closeOrder(userId, openOrders[index])) {
        openOrders.splice(index, 1);
      }
    } else if (
      status === "ACKNOWLEDGED" ||
      status === "ESCALATED" ||
      status === "UNDER_REVIEW" ||
      status === "COMPLETED" ||
      status === "CANCELLED" ||
      status === "EXPIRED"
    ) {
      openOrders.splice(index, 1);
    }
  }
}

function requesterReads(userId) {
  if (__ITER % 5 === 0) {
    readJson(userId, `${orderUrl}/api/v1/orders/requests/active?page=0&size=20`, "requests_active");
    readJson(userId, `${orderUrl}/api/v1/orders/alerts?page=0&size=20`, "alerts");
  }
  if (__ITER % 10 === 0) {
    readJson(userId, `${orderUrl}/api/v1/orders/mine?page=0&size=20`, "mine");
    readJson(userId, `${orderUrl}/api/v1/orders/requests/past?page=0&size=20`, "requests_past");
  }
}

function courier(userId) {
  // Most deliver iterations are idle think-time; only a share browses the pool.
  if (Math.random() < courierBrowseProbability) {
    const pool = readJson(userId, `${orderUrl}/api/v1/orders?page=0&size=20`, "pool");
    const content = pool && pool.content ? pool.content : [];
    // Never accept our own request — Order returns 409 and that is a real reject.
    // Race "already taken" 409 from another courier is expected and counts as OK.
    const candidates = content.filter(
      (order) =>
        order &&
        order.id &&
        String(order.requesterId || "").toLowerCase() !== String(userId).toLowerCase() &&
        !openOrders.includes(order.id),
    );
    if (candidates.length > 0) {
      const order = candidates[Math.floor(Math.random() * candidates.length)];
      const accepted = http.post(
        `${orderUrl}/api/v1/orders/${order.id}/accept`,
        null,
        // 409 = already claimed (expected contention), not a threshold failure.
        params(userId, "fulfill", "accept", [200, 409]),
      );
      check(accepted, {
        "accept claimed or already taken": (response) => response.status === 200 || response.status === 409,
      });
      if (accepted.status === 200) {
        upload(userId, order.id, "collect");
        upload(userId, order.id, "deliver");
      }
    }
  }
  // Occasional courier list/search — not every browse, not every idle tick.
  if (__ITER % 10 === 0) {
    readJson(userId, `${orderUrl}/api/v1/orders/deliveries/active?page=0&size=20`, "deliveries_active");
    readJson(userId, `${orderUrl}/api/v1/orders/deliveries/past?page=0&size=20`, "deliveries_past");
    readJson(
      userId,
      `${orderUrl}/api/v1/orders/search?pickupLocationId=${pickupId}&page=0&size=20`,
      "search",
    );
  }
}

function createOrder(userId) {
  const now = Date.now();
  const response = http.post(
    `${orderUrl}/api/v1/orders`,
    JSON.stringify({
      itemDescription: "Load test drop",
      credits: 1,
      expiryTime: new Date(now + 2 * 60 * 60 * 1000).toISOString(),
      deliveryTime: new Date(now + 5 * 60 * 60 * 1000).toISOString(),
      fromLocation: pickupId,
      deliveryPointId: dropoffId,
    }),
    params(userId, "create", "create", [201]),
  );
  const ok = check(response, { "order created": (body) => body.status === 201 });
  if (!ok) {
    return null;
  }
  return response.json("id");
}

function closeOrder(userId, orderId) {
  if (__ITER % escalateEvery === 0) {
    const response = http.post(
      `${orderUrl}/api/v1/orders/${orderId}/escalate`,
      JSON.stringify({ disputeText: "Load test dispute" }),
      params(userId, "close", "escalate", [200, 409]),
    );
    const ok = response.status === 200 || response.status === 409;
    check(response, { "escalated or already closed": () => ok });
    return ok;
  }
  const response = http.post(
    `${orderUrl}/api/v1/orders/${orderId}/acknowledge`,
    null,
    params(userId, "close", "acknowledge", [200, 409]),
  );
  const ok = response.status === 200 || response.status === 409;
  check(response, { "acknowledged or already closed": () => ok });
  return ok;
}

function upload(userId, orderId, action) {
  const response = http.post(
    `${orderUrl}/api/v1/orders/${orderId}/${action}`,
    { photo: http.file(photo, `${action}.png`, "image/png") },
    {
      headers: { "X-User-Id": userId, "X-Permitted-Action": "true" },
      tags: { op: "fulfill", name: action },
      timeout: "30s",
      responseCallback: http.expectedStatuses(200),
    },
  );
  check(response, { [`${action} stored a photo`]: (body) => body.status === 200 });
}

function orderStatus(userId, orderId) {
  const body = readJson(userId, `${orderUrl}/api/v1/orders/${orderId}`, "get_order");
  return body && body.status ? body.status : "";
}

function readJson(userId, url, name) {
  const response = http.get(url, params(userId, "read", name, [200]));
  check(response, { "read ok": (body) => body.status === 200 });
  if (response.status !== 200) {
    return null;
  }
  return response.json();
}

function params(userId, op, name, statuses) {
  return {
    headers: {
      "X-User-Id": userId,
      "X-Permitted-Action": "true",
      "Content-Type": "application/json",
    },
    tags: { op, name },
    timeout: "30s",
    responseCallback: http.expectedStatuses(...statuses),
  };
}

function intEnv(name, fallback) {
  const parsed = Number(__ENV[name] || fallback);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
  return parsed;
}
