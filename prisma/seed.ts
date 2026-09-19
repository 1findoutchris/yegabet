import { PrismaClient } from "@prisma/client";
import { DEFAULT_REWARD_CONFIG } from "../src/lib/rewardConfigCore";

/*
 * Seeds the rows the app cannot run without.
 *
 * `prisma migrate reset` leaves an empty schema, but getRewardConfig() is read
 * by register, deposit, withdraw, spin, the provider callback and admin/users.
 * With no reward_config rows every one of those silently falls back to code
 * defaults — a different path from production, and a confusing one to debug.
 *
 * Everything here is an upsert, so it is safe to re-run against a live
 * database. It creates no users and no money.
 */

const prisma = new PrismaClient();

async function main() {
  for (const [key, value] of Object.entries(DEFAULT_REWARD_CONFIG)) {
    await prisma.rewardConfig.upsert({
      where: { key },
      create: { key, value: value as object },
      update: {}, // never clobber values an admin has tuned
    });
  }
  console.log(`✅ reward config: ${Object.keys(DEFAULT_REWARD_CONFIG).length} blocks`);

  // Destination accounts shown on the deposit page. Placeholder numbers — the
  // admin edits these at /admin/<secret>/payment-methods.
  for (const id of ["telebirr", "cbebirr", "ebirr"]) {
    await prisma.paymentAgent.upsert({
      where: { id },
      create: { id, agentNumber: "0900000000", agentName: "Set me in admin" },
      update: {},
    });
  }
  console.log("✅ payment agents: telebirr, cbebirr, ebirr");

  console.log("");
  console.log("Admin credentials come from environment variables:");
  console.log(`   ADMIN_USERNAME : ${process.env.ADMIN_USERNAME ?? "(not set!)"}`);
  console.log(`   ADMIN_PASSWORD : ${process.env.ADMIN_PASSWORD ? "(set)" : "(not set!)"}`);
  console.log(`   ADMIN_SECRET   : ${process.env.ADMIN_SECRET ? "(set)" : "(not set!)"}`);
  console.log(`Admin URL: /admin/${process.env.ADMIN_SECRET ?? "<ADMIN_SECRET>"}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
