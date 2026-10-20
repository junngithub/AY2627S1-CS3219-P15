import "dotenv/config";
import { AdminBootstrapError, bootstrapFirstAdmin, parseBootstrapAdminArguments } from "./admin-bootstrap";
import { prisma } from "./db";

const usage = `Usage: node dist/bootstrap-admin.js --user-id <UUID> --confirm

Deployment-only first-admin setup. Requires a privileged operator and DATABASE_URL
for the intended User Service database. Run migrations first. The target must
already be verified, active, unlocked and not pending deletion. Refuses if ANY
admin exists or bootstrap was previously recorded. Revokes the target's sessions
and outstanding password-reset links; the account must sign in again afterward.
This command does not create users, verify them or expose an HTTP endpoint.
`;

export async function runBootstrapAdminCommand(args = process.argv.slice(2)): Promise<number> {
  try {
    const options = parseBootstrapAdminArguments(args);
    if (options.help) {
      console.log(usage);
      return 0;
    }
    if (!process.env.DATABASE_URL?.trim()) {
      throw new AdminBootstrapError("DATABASE_NOT_CONFIGURED", "DATABASE_URL must identify the intended User Service database.");
    }
    const result = await bootstrapFirstAdmin(options.userId);
    console.log(JSON.stringify({ ...result, message: "First administrator assigned. Sign in again with the existing account password." }));
    return 0;
  } catch (error) {
    if (error instanceof AdminBootstrapError) {
      console.error(`${error.code}: ${error.message}`);
    } else {
      // Prisma errors can contain connection details: never dump them here.
      console.error("BOOTSTRAP_FAILED: Database operation failed. Check connectivity, permissions and applied migrations; no partial promotion is committed.");
    }
    return 1;
  } finally {
    await prisma.$disconnect().catch(() => undefined);
  }
}

if (require.main === module) {
  void runBootstrapAdminCommand().then((exitCode) => { process.exitCode = exitCode; });
}
