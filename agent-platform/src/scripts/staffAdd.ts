import { PrismaClient } from "@prisma/client";
import { audit } from "../auth/audit";
import { STAFF_ROLES, type StaffRole } from "../auth/rbac";

/**
 * Create (or extend) a staff member from the server console. This is how the
 * first owner gets in, before any admin screen exists (plan 04 §10). Idempotent.
 *
 *   npm run staff:add -- --telegram-id 5347803735 --name "Owner" --role owner
 */
function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main(): Promise<void> {
  const telegramUserId = arg("telegram-id");
  const displayName = arg("name") ?? "Staff";
  const role = arg("role") as StaffRole | undefined;
  if (!telegramUserId || !/^\d+$/.test(telegramUserId) || !role || !STAFF_ROLES.includes(role)) {
    console.error(`usage: --telegram-id <digits> --name <name> --role <${STAFF_ROLES.join("|")}>`);
    process.exitCode = 1;
    return;
  }
  const db = new PrismaClient();
  try {
    const staff = await db.staff.upsert({
      where: { telegramUserId },
      create: { telegramUserId, displayName },
      update: {},
    });
    await db.staffRole.upsert({
      where: { staffId_roleKey: { staffId: staff.id, roleKey: role } },
      create: { staffId: staff.id, roleKey: role, grantedBy: "console" },
      update: {},
    });
    await audit(db, {
      actorKind: "console",
      action: "staff.role_granted",
      target: `staff:${staff.id}`,
      after: { role },
    });
    const roles = await db.staffRole.findMany({ where: { staffId: staff.id }, select: { roleKey: true } });
    console.log(
      `staff ${staff.id} (${staff.displayName}, telegram ${telegramUserId}): ${roles.map((r) => r.roleKey).join(", ")}`,
    );
  } finally {
    await db.$disconnect();
  }
}

void main();
