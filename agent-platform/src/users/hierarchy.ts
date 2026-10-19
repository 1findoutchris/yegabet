import { Prisma, PrismaClient, type Agent } from "@prisma/client";
import type { Ledger } from "../ledger/ledger";
import { UsersError } from "./errors";

/**
 * Agents and their tree (CLAUDE.md §5.2). The ancestor path is computed by the
 * database from the parent and can never change afterwards; this class only
 * reads it. Creating an agent posts no ledger entries (§3: no recruitment
 * rewards). It opens the agent's three accounts at zero, in the same transaction.
 */

export const AGENT_ACCOUNT_TYPES = ["AGENT_CASH_POSITION", "AGENT_PAYABLE", "PARENT_PAYABLE"] as const;

const SLUG = /^[a-z0-9-]{3,40}$/;

export class Hierarchy {
  constructor(
    private readonly db: PrismaClient,
    private readonly ledger: Ledger,
  ) {}

  async createAgent(input: { slug: string; displayName: string; parentId?: bigint }): Promise<Agent> {
    if (typeof input.slug !== "string" || !SLUG.test(input.slug)) {
      throw new UsersError("INVALID_INPUT", "slug must be 3–40 characters: a–z, 0–9 or -");
    }
    if (typeof input.displayName !== "string" || input.displayName.trim() === "") {
      throw new UsersError("INVALID_INPUT", "displayName is required");
    }
    try {
      return await this.db.$transaction(async (tx) => {
        const agent = await tx.agent.create({
          data: { slug: input.slug, displayName: input.displayName.trim(), parentId: input.parentId ?? null },
        });
        for (const type of AGENT_ACCOUNT_TYPES) {
          await this.ledger.openAccount({ type, ownerKind: "agent", ownerId: agent.id.toString() }, tx);
        }
        return agent;
      });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
        throw new UsersError("SLUG_TAKEN", `slug "${input.slug}" is already taken`);
      }
      // The agents_path trigger refuses a missing, inactive or company parent.
      const message = String(Object(e).message);
      const parentProblem =
        /parent agent \d+ does not exist|the company agent cannot be a parent|parent agent \d+ is not active/.exec(
          message,
        );
      if (parentProblem) throw new UsersError("INVALID_PARENT", parentProblem[0]);
      throw e;
    }
  }

  /** The single company agent: owner of every direct registration. */
  companyAgent(): Promise<Agent> {
    return this.db.agent.findFirstOrThrow({ where: { isCompany: true } });
  }

  async get(agentId: bigint): Promise<Agent> {
    const agent = await this.db.agent.findUnique({ where: { id: agentId } });
    if (!agent) throw new UsersError("NOT_FOUND", `agent ${agentId} not found`);
    return agent;
  }

  /** Ancestors from the root down to the direct parent. */
  async ancestors(agentId: bigint): Promise<bigint[]> {
    return (await this.get(agentId)).ancestors;
  }

  /** The parent `level` steps up (1 = direct parent), or null when the tree is shallower. */
  async parentAt(agentId: bigint, level: number): Promise<bigint | null> {
    if (!Number.isInteger(level) || level < 1) throw new UsersError("INVALID_INPUT", "level must be >= 1");
    const path = await this.ancestors(agentId);
    return path[path.length - level] ?? null;
  }

  /** Every agent below `agentId` (not including itself), via the GIN-indexed path. */
  async subtree(agentId: bigint): Promise<bigint[]> {
    await this.get(agentId);
    const rows = await this.db.agent.findMany({
      where: { ancestors: { has: agentId } },
      select: { id: true },
      orderBy: { id: "asc" },
    });
    return rows.map((r) => r.id);
  }
}
