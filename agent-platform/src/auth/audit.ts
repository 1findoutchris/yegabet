import type { Prisma, PrismaClient } from "@prisma/client";

/**
 * Append-only audit log (CLAUDE.md §3: who, what, when, before/after, IP).
 * Never put phone numbers, tokens or payment references in it (§7).
 */
export interface AuditEntry {
  actorKind?: string;
  actorId?: string;
  action: string;
  target?: string;
  before?: Prisma.InputJsonValue;
  after?: Prisma.InputJsonValue;
  ip?: string;
}

export async function audit(db: PrismaClient | Prisma.TransactionClient, entry: AuditEntry): Promise<void> {
  await db.auditLog.create({ data: entry });
}
