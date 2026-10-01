# User Service

Owns user registration, verification, authentication, profile status, account lifecycle, and friendships for Friends on Campus.

## Current implementation

- Express + TypeScript service on port `8080`
- PostgreSQL schema managed by Prisma
- Six-digit email OTPs (only hashes are stored)
- Password hashing with Node.js `scrypt` and a unique salt per password
- Opaque bearer sessions (only token hashes are stored)
- Generic login failures and lockout after a configurable number of failed attempts
- Account status and profile retrieval
- Interactive Swagger/OpenAPI documentation
- Docker Compose configuration for the service and its own PostgreSQL database

Telegram verification, password reset, account deletion, friendship management, real email delivery, and Kafka event publishing are later milestones.

## Swagger API documentation

While the User Service is running, open:

```text
http://localhost:8080/api-docs
```

The Swagger page lists every currently implemented endpoint and allows requests to be tried from the browser. After logging in, copy the returned token, select **Authorize**, and paste the token to call protected endpoints. Swagger automatically adds the `Bearer` prefix.

The raw OpenAPI 3.0 document is available at:

```text
http://localhost:8080/api-docs.json
```

## API implemented

All errors use:

```json
{
  "error": "Human-readable message",
  "code": "MACHINE_READABLE_CODE"
}
```

### Health

```http
GET /health
```

### Sign up

```http
POST /api/v1/user/signup
Content-Type: application/json

{
  "email": "student@u.nus.edu",
  "password": "SecurePass1",
  "telegramHandle": "student_handle",
  "name": "Optional Display Name"
}
```

`name` is temporarily optional until the team confirms where the immutable profile name comes from. If omitted, the portion of the email before `@` is used.

### Verify email OTP

```http
POST /api/v1/user/verify-email
Content-Type: application/json

{
  "email": "student@u.nus.edu",
  "otp": "123456"
}
```

In development, the OTP is printed in the User Service log. A real email provider has not been selected yet.

### Resend verification OTP

```http
POST /api/v1/user/resend-verification
Content-Type: application/json

{
  "email": "student@u.nus.edu"
}
```

The response does not reveal whether an account exists.

### Login

```http
POST /api/v1/user/login
Content-Type: application/json

{
  "email": "student@u.nus.edu",
  "password": "SecurePass1"
}
```

Successful response:

```json
{
  "token": "opaque-random-token",
  "tokenType": "Bearer",
  "expiresAt": "2026-09-30T00:00:00.000Z",
  "user": {
    "id": "uuid",
    "name": "student",
    "email": "student@u.nus.edu",
    "status": "Created"
  }
}
```

### Authorize

```http
POST /api/v1/user/authorize
Authorization: Bearer <token>
```

Successful response:

```http
HTTP/1.1 200 OK
x-user-id: uuid
x-is-admin: false
x-permitted-action: false
Cache-Control: no-store
```

```json
{
  "authenticated": true,
  "userId": "uuid",
  "isAdmin": false,
  "permittedAction": false
}
```

`permittedAction` becomes true when the account is active and both email and Telegram have been verified.

The API gateway calls this endpoint for every protected request (see `infra/docs/adr/0007-envoy-gateway-extauth.md`), so:

- **Any method is accepted.** The gateway's check uses the client's method (`GET /api/v1/orders` is checked as `GET /authorize`) and sends no body.
- **Identity is in the headers.** The gateway ignores the JSON body and copies `x-user-id`, `x-is-admin` and `x-permitted-action` onto the request it forwards. The JSON is for other callers.
- **Nothing is cached**, so a suspension applies to the next request.

### Profile and status

```http
GET /api/v1/user/me
Authorization: Bearer <token>
```

```http
GET /api/v1/user/me/status
Authorization: Bearer <token>
```

## Run without Docker

Install dependencies and generate the Prisma client:

```powershell
npm install
npm run prisma:generate
```

Copy `.env.example` to `.env`, provide a reachable PostgreSQL `DATABASE_URL`, then run:

```powershell
npm run prisma:migrate
npm run dev
```

## Run with Docker

After installing Docker Desktop:

```powershell
docker compose up --build
```

The database is exposed locally on port `5554`; the API is exposed on port `8080`.

## Verification commands

```powershell
npm test
npm run build
npx prisma validate
```
