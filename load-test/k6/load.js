// Backend load through the API gateway.
// Each VU logs in once (POST /api/v1/user/login), then calls Order with
// Authorization: Bearer <session>. The gateway authorizes and injects identity.
//
//   node load-test/setup/seed-users.mjs --apply
//   k6 run load-test/k6/load.js
//   k6 run -e VUS=30 -e DURATION=30s -e BASE_URL=http://localhost:8080 load-test/k6/load.js
//
// VUS and REQUESTER_SHARE must match setup/seed-users.mjs.
//
// Metrics cardinality (Prometheus / Grafana Cloud):
// Paths like /orders/${id}/accept would otherwise make one series per order via the
// default `url` (and default `name`=URL) tags. Fix: set tags.name to a stable endpoint
// id, and omit `url` from systemTags (name alone does not clear the url label).

import encoding from "k6/encoding";
import http from "k6/http";
import { check, sleep } from "k6";
import { SharedArray } from "k6/data";

const total = intEnv("VUS", 9600);
const share = Number(__ENV.REQUESTER_SHARE || 0.3);
const requesterVus = Math.round(total * share);
const courierVus = total - requesterVus;
// Gateway by default (local deploy/local.sh gateway → :8080). ORDER_URL still works.
const baseUrl = (__ENV.BASE_URL || __ENV.GATEWAY_URL || __ENV.ORDER_URL || "http://localhost:8080").replace(/\/$/, "");
const pickupId = __ENV.PICKUP_ID || "2";
const dropoffId = Number(__ENV.DROPOFF_ID || 1);
const escalateEvery = intEnv("ESCALATE_EVERY", 20);
const think = Number(__ENV.THINK_SECONDS || 1);

const seeded = new SharedArray("users", () => {
  const data = JSON.parse(open("../data/users.json"));
  return [{
    password: data.password || __ENV.LOAD_PASSWORD || "LoadTestPass1",
    requesters: data.requesters,
    couriers: data.couriers,
  }];
});

const photo = encoding.b64decode(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII=",
);

if (seeded[0].requesters.length < requesterVus || seeded[0].couriers.length < courierVus) {
  throw new Error("users.json is smaller than this VUS. Re-run setup/seed-users.mjs with the same VUS.");
}

const openOrders = [];
// Per-VU copy of init state: one login session for this VU's user.
let sessionToken = null;
let sessionEmail = null;

export const options = {
  // systemTags only lists built-in tags. Custom `op` still comes from request tags.
  // Must not include `url` — that label keeps the full path with order UUIDs.
  systemTags: ["status", "method", "name", "expected_response", "scenario", "group", "check"],
  scenarios: {
    traffic: {
      executor: "constant-vus",
      vus: total,
      duration: __ENV.DURATION || "10m",
      exec: "traffic",
    },
  },
  thresholds: {
    "http_req_failed{op:login}": ["rate<0.05"],
    "http_req_failed{op:create}": ["rate<0.05"],
    "http_req_failed{op:read}": ["rate<0.05"],
    "http_req_failed{op:fulfill}": ["rate<0.05"],
    "http_req_failed{op:close}": ["rate<0.05"],
  },
};

export function traffic() {
  if (__VU <= requesterVus) {
    const user = seeded[0].requesters[(__VU - 1) % seeded[0].requesters.length];
    if (!ensureSession(user)) {
      sleep(think);
      return;
    }
    requester();
  } else {
    const index = __VU - requesterVus - 1;
    const user = seeded[0].couriers[index % seeded[0].couriers.length];
    if (!ensureSession(user)) {
      sleep(think);
      return;
    }
    courier();
  }
  sleep(think);
}

function ensureSession(user) {
  if (sessionToken && sessionEmail === user.email) {
    return true;
  }
  const response = http.post(
    `${baseUrl}/api/v1/user/login`,
    JSON.stringify({ email: user.email, password: seeded[0].password }),
    {
      headers: { "Content-Type": "application/json" },
      tags: { op: "login", name: "login" },
      timeout: "30s",
      responseCallback: http.expectedStatuses(200),
    },
  );
  const ok = check(response, { "logged in": (body) => body.status === 200 && !!body.json("token") });
  if (!ok) {
    sessionToken = null;
    sessionEmail = null;
    return false;
  }
  sessionToken = response.json("token");
  sessionEmail = user.email;
  return true;
}

function requester() {
  if (openOrders.length < 3) {
    const created = createOrder();
    if (created) {
      openOrders.push(created);
    }
  }
  for (let index = openOrders.length - 1; index >= 0; index -= 1) {
    const status = orderStatus(openOrders[index]);
    if (status === "DELIVERED") {
      closeOrder(openOrders[index]);
      openOrders.splice(index, 1);
    } else if (status === "ACKNOWLEDGED" || status === "ESCALATED" || status === "UNDER_REVIEW" || status === "COMPLETED" || status === "CANCELLED" || status === "EXPIRED") {
      openOrders.splice(index, 1);
    }
  }
  if (__ITER % 5 === 0) {
    readJson(`${baseUrl}/api/v1/orders/requests/active?page=0&size=20`, "requests_active");
    readJson(`${baseUrl}/api/v1/orders/alerts?page=0&size=20`, "alerts");
  }
  if (__ITER % 10 === 0) {
    readJson(`${baseUrl}/api/v1/orders/mine?page=0&size=20`, "mine");
    readJson(`${baseUrl}/api/v1/orders/requests/past?page=0&size=20`, "requests_past");
  }
}

function courier() {
  const pool = readJson(`${baseUrl}/api/v1/orders?page=0&size=20`, "pool");
  const content = pool && pool.content ? pool.content : [];
  if (content.length > 0) {
    const order = content[Math.floor(Math.random() * content.length)];
    const accepted = http.post(
      `${baseUrl}/api/v1/orders/${order.id}/accept`,
      null,
      params("fulfill", "accept", [200, 409]),
    );
    check(accepted, { "accept claimed or already taken": (response) => response.status === 200 || response.status === 409 });
    if (accepted.status === 200) {
      upload(order.id, "collect");
      upload(order.id, "deliver");
    }
  }
  if (__ITER % 5 === 0) {
    readJson(`${baseUrl}/api/v1/orders/deliveries/active?page=0&size=20`, "deliveries_active");
    readJson(`${baseUrl}/api/v1/orders/deliveries/past?page=0&size=20`, "deliveries_past");
    readJson(
      `${baseUrl}/api/v1/orders/search?pickupLocationId=${pickupId}&page=0&size=20`,
      "search",
    );
  }
}

function createOrder() {
  const now = Date.now();
  const response = http.post(
    `${baseUrl}/api/v1/orders`,
    JSON.stringify({
      itemDescription: "Load test drop",
      credits: 1,
      expiryTime: new Date(now + 2 * 60 * 60 * 1000).toISOString(),
      deliveryTime: new Date(now + 5 * 60 * 60 * 1000).toISOString(),
      fromLocation: pickupId,
      deliveryPointId: dropoffId,
    }),
    params("create", "create", [201]),
  );
  const ok = check(response, { "order created": (body) => body.status === 201 });
  if (!ok) {
    return null;
  }
  return response.json("id");
}

function closeOrder(orderId) {
  if (__ITER % escalateEvery === 0) {
    const response = http.post(
      `${baseUrl}/api/v1/orders/${orderId}/escalate`,
      JSON.stringify({ disputeText: "Load test dispute" }),
      params("close", "escalate", [200, 409]),
    );
    check(response, { "escalated or already closed": (body) => body.status === 200 || body.status === 409 });
    return;
  }
  const response = http.post(
    `${baseUrl}/api/v1/orders/${orderId}/acknowledge`,
    null,
    params("close", "acknowledge", [200, 409]),
  );
  check(response, { "acknowledged or already closed": (body) => body.status === 200 || body.status === 409 });
}

function upload(orderId, action) {
  const response = http.post(
    `${baseUrl}/api/v1/orders/${orderId}/${action}`,
    { photo: http.file(photo, `${action}.png`, "image/png") },
    {
      headers: { Authorization: `Bearer ${sessionToken}` },
      tags: { op: "fulfill", name: action },
      timeout: "30s",
      responseCallback: http.expectedStatuses(200),
    },
  );
  check(response, { [`${action} stored a photo`]: (body) => body.status === 200 });
}

function orderStatus(orderId) {
  const body = readJson(`${baseUrl}/api/v1/orders/${orderId}`, "get_order");
  return body && body.status ? body.status : "";
}

function readJson(url, name) {
  const response = http.get(url, params("read", name, [200]));
  check(response, { "read ok": (body) => body.status === 200 });
  if (response.status !== 200) {
    return null;
  }
  return response.json();
}

function params(op, name, statuses) {
  return {
    headers: {
      Authorization: `Bearer ${sessionToken}`,
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
