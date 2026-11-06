// Seed verified users and credit balances for the k6 run.
//
//   node load-test/setup/seed-users.mjs
//   node load-test/setup/seed-users.mjs --apply
//
// VUS (default 9600) and REQUESTER_SHARE (default 0.3) must match the k6 run.
// CREDIT_BALANCE (default 5000) is the requester balance. Each order spends 1.
// LOAD_PASSWORD (default LoadTestPass1) is the shared login password; its scrypt
// hash is written into User.passwordHash so k6 can POST /api/v1/user/login.
// Local --apply pipes SQL into Docker Postgres. Against EKS, generate the files
// here, then apply users.sql and credits.sql to the User and Credit databases.

import { createHash, randomBytes, scrypt } from "node:crypto";
import { spawn } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { positiveInt, rosterFromEnv } from "./roster.mjs";

const scryptAsync = promisify(scrypt);
const root = join(dirname(fileURLToPath(import.meta.url)), "..", "data");
const requesterBalance = positiveInt(process.env.CREDIT_BALANCE, 5000);
const courierBalance = positiveInt(process.env.COURIER_BALANCE, 100);
const password = process.env.LOAD_PASSWORD || "LoadTestPass1";
const scryptCost = positiveInt(process.env.PASSWORD_SCRYPT_COST, 16384);
const apply = process.argv.includes("--apply");
const { total, share, requesters, couriers } = rosterFromEnv();
for (const row of [...requesters, ...couriers]) {
  row.id = uuid(`${row.role}-${row.email}`);
  row.password = password;
}

const passwordHash = await hashPassword(password, scryptCost);

mkdirSync(root, { recursive: true });
writeFileSync(
  join(root, "users.json"),
  JSON.stringify({
    vus: total,
    requesterShare: share,
    password,
    requesters,
    couriers,
  }),
);
const userSql = join(root, "users.sql");
const creditSql = join(root, "credits.sql");
writeFileSync(userSql, userInserts([...requesters, ...couriers], passwordHash));
writeFileSync(creditSql, creditInserts(requesters, requesterBalance) + creditInserts(couriers, courierBalance));

console.log(
  `Wrote ${requesters.length} requesters and ${couriers.length} couriers to ${root} (login password set)`,
);

if (apply) {
  const userDb = process.env.USER_DB_CONTAINER ?? "user-service-db-1";
  const creditDb = process.env.CREDIT_DB_CONTAINER ?? "credit-postgres";
  await psql(userDb, process.env.USER_DB_USER ?? "user_service", process.env.USER_DB_NAME ?? "user_db", userSql);
  await psql(creditDb, process.env.CREDIT_DB_USER ?? "credit", process.env.CREDIT_DB_NAME ?? "credit_db", creditSql);
  console.log("Applied user and credit seeds");
}

function uuid(name) {
  const bytes = createHash("sha256").update(`foc-load-v1-${name}`).digest().subarray(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** Same encoding as user-service/src/security.ts hashPassword. */
async function hashPassword(plain, cost) {
  const salt = randomBytes(16);
  const derived = await scryptAsync(plain, salt, 64, {
    N: cost,
    r: 8,
    p: 1,
    maxmem: 64 * 1024 * 1024,
  });
  return `scrypt$${cost}$${salt.toString("hex")}$${derived.toString("hex")}`;
}

function sqlString(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

function userInserts(rows, hash) {
  const hashSql = sqlString(hash);
  const batches = chunks(rows, 400).map((batch) => {
    const values = batch
      .map(
        (row) =>
          `(${sqlString(row.id)},${sqlString(row.email)},${sqlString(row.name)},${hashSql},${sqlString(row.telegramHandle)},NOW(),NOW(),'USER','ACTIVE',0,0,NOW(),NOW())`,
      )
      .join(",\n");
    return `INSERT INTO "User" (
  id, email, name, "passwordHash", "telegramHandle",
  "emailVerifiedAt", "telegramVerifiedAt", role, "accessStatus",
  "failedLoginAttempts", "authVersion", "createdAt", "updatedAt"
) VALUES
${values}
ON CONFLICT (id) DO UPDATE SET
  "passwordHash" = EXCLUDED."passwordHash",
  "emailVerifiedAt" = EXCLUDED."emailVerifiedAt",
  "telegramVerifiedAt" = EXCLUDED."telegramVerifiedAt",
  "accessStatus" = 'ACTIVE',
  "failedLoginAttempts" = 0,
  "lockedAt" = NULL,
  "updatedAt" = NOW();`;
  });
  return `${batches.join("\n")}\n`;
}

function creditInserts(rows, balance) {
  const batches = chunks(rows, 400).map((batch) => {
    const values = batch.map((row) => `(${sqlString(row.id)},${balance})`).join(",\n");
    return `INSERT INTO credit_user (user_id, balance) VALUES
${values}
ON CONFLICT (user_id) DO UPDATE SET balance = EXCLUDED.balance, updated_at = NOW();`;
  });
  return `${batches.join("\n")}\n`;
}

function chunks(rows, size) {
  const out = [];
  for (let index = 0; index < rows.length; index += size) {
    out.push(rows.slice(index, index + size));
  }
  return out;
}

function psql(container, user, database, file) {
  return new Promise((resolve, reject) => {
    const child = spawn(
      "docker",
      ["exec", "-i", container, "psql", "-U", user, "-d", database, "-v", "ON_ERROR_STOP=1"],
      { stdio: ["pipe", "inherit", "inherit"] },
    );
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`psql in ${container} exited ${code}`));
      }
    });
    child.stdin.end(readFileSync(file));
  });
}
