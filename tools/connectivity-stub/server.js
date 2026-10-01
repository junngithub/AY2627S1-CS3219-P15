// Connectivity stub: stands in for a FoC service that has no image yet, so
// the platform (DNS, network policy, gateway, auth, Kafka credentials, image
// pulls) can be tested end to end. It has no business logic.
//
//   GET /health  → {"status":"ok","service":"<SERVICE_NAME>"}
//   *   /*       → echo: service, method, path, and the identity headers the
//                  gateway added (x-user-id / x-is-admin), so tests can see
//                  exactly what reached the backend
//
// When running as "user", it also stands in for User's auth endpoint
// (ADR-0007), mirroring the order service's local stub mode:
//   * /api/v1/user/authorize
//       Authorization: Bearer stub:<name>@u.nus.edu | stub:<name>@nus.edu.sg
//         → 200, headers x-user-id: <email>, x-is-admin: true if <name> starts with "admin"
//       anything else → 401
//
// Env: PORT (default 3000), SERVICE_NAME (default "stub").
import { createServer } from 'node:http';

const port = Number.parseInt(process.env.PORT ?? '3000', 10);
const service = process.env.SERVICE_NAME ?? 'stub';

const AUTHORIZE_PATH = '/api/v1/user/authorize';
const STUB_TOKEN = /^Bearer stub:([a-z0-9._-]+@(?:u\.nus\.edu|nus\.edu\.sg))$/i;

function send(res, status, body, headers = {}) {
  res.writeHead(status, { 'content-type': 'application/json', ...headers });
  res.end(JSON.stringify(body));
}

function authorize(req, res) {
  const match = STUB_TOKEN.exec(req.headers.authorization ?? '');
  if (!match) {
    return send(res, 401, { authenticated: false });
  }
  const userId = match[1].toLowerCase();
  const isAdmin = userId.startsWith('admin');
  return send(
    res,
    200,
    { authenticated: true, userId, isAdmin },
    { 'x-user-id': userId, 'x-is-admin': String(isAdmin) },
  );
}

const server = createServer((req, res) => {
  const path = (req.url ?? '/').split('?')[0];
  if (path === '/health') {
    return send(res, 200, { status: 'ok', service });
  }
  if (service === 'user' && path === AUTHORIZE_PATH) {
    return authorize(req, res);
  }
  return send(res, 200, {
    service,
    stub: true,
    method: req.method,
    path: req.url,
    userId: req.headers['x-user-id'] ?? null,
    isAdmin: req.headers['x-is-admin'] ?? null,
  });
});

server.listen(port, '0.0.0.0', () => {
  console.log(JSON.stringify({ msg: 'connectivity stub listening', service, port }));
});

// Exit promptly on `kubectl delete` / rollout instead of waiting for SIGKILL.
for (const signal of ['SIGTERM', 'SIGINT']) {
  process.on(signal, () => server.close(() => process.exit(0)));
}
