import { Prisma, PrismaClient, type Player } from "@prisma/client";
import type { Ledger } from "../ledger/ledger";
import { UsersError } from "./errors";
import { encryptPhone, hashPhone, normalizeEthiopianPhone } from "./phone";

export interface PhoneKeys {
  /** HMAC key for the uniqueness hash. */
  hashKey: string;
  /** AES-256-GCM key, 32 bytes base64. */
  encKey: string;
}

export const PLAYER_ACCOUNT_TYPES = ["PLAYER_WALLET", "PLAYER_HELD"] as const;

/**
 * Player records (CLAUDE.md §5.2, §5.5). Proving the phone belongs to the
 * person (Telegram contact share) is Task 04; this only records a verified one.
 */
export class Players {
  constructor(
    private readonly db: PrismaClient,
    private readonly ledger: Ledger,
    private readonly keys: PhoneKeys,
  ) {}

  /**
   * One DB transaction: the player row, their first assignment (to the
   * referral agent, else the company agent) and their two zero-balance
   * accounts. Either all exist or none.
   */
  async register(input: { phone: string; telegramUserId?: string; referralSlug?: string }): Promise<Player> {
    const e164 = normalizeEthiopianPhone(input.phone);
    const phoneHash = hashPhone(e164, this.keys.hashKey);

    try {
      return await this.db.$transaction(async (tx) => {
        const agent = input.referralSlug
          ? await tx.agent.findUnique({ where: { slug: input.referralSlug } })
          : await tx.agent.findFirstOrThrow({ where: { isCompany: true } });
        // A broken or paused agent link is refused, not silently given to the
        // company: that would hide the broken link from the agent (plan 03 §7).
        if (!agent || agent.status !== "active") {
          throw new UsersError("INVALID_REFERRAL", "this referral link is not valid");
        }

        const player = await tx.player.create({
          data: {
            phoneHash,
            phoneEnc: encryptPhone(e164, this.keys.encKey),
            telegramUserId: input.telegramUserId ?? null,
            agentId: agent.id,
          },
        });
        await tx.agentAssignment.create({
          data: { playerId: player.id, agentId: agent.id, reason: "registration" },
        });
        for (const type of PLAYER_ACCOUNT_TYPES) {
          await this.ledger.openAccount({ type, ownerKind: "player", ownerId: player.id.toString() }, tx);
        }
        return player;
      });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
        if (String(JSON.stringify(e.meta)).includes("telegram_user_id")) {
          throw new UsersError("TELEGRAM_TAKEN", "this Telegram account is already registered");
        }
        throw new UsersError("PHONE_TAKEN", "this phone number is already registered");
      }
      throw e;
    }
  }

  async findByPhone(phone: string): Promise<Player | null> {
    const phoneHash = hashPhone(normalizeEthiopianPhone(phone), this.keys.hashKey);
    return this.db.player.findUnique({ where: { phoneHash } });
  }

  /** The agent the player belongs to now (from the open assignment row). */
  async currentAgentId(playerId: bigint): Promise<bigint> {
    const row = await this.db.agentAssignment.findFirst({
      where: { playerId, effectiveTo: null },
      select: { agentId: true },
    });
    if (!row) throw new UsersError("NOT_FOUND", `player ${playerId} not found`);
    return row.agentId;
  }
}
