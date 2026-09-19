import { beforeAll, beforeEach, describe, expect, test } from "vitest";
import { prisma } from "@/lib/prisma";
import { POST } from "@/app/api/admin/spin/links/route";
import { makeSpinPrize, truncateAll } from "../factories";
import { adminAuth } from "../helpers/auth";
import { json, req } from "../helpers/req";

/*
 * Bulk generation of guaranteed-win links.
 *
 * Every link in a batch is an independent promise to pay the prize, so
 * `count × cashEtb` is real money. The cap and the all-or-nothing insert are
 * the two things keeping a slipped keypress from minting a hundred payouts.
 */

async function generate(body: Record<string, unknown>) {
  const auth = await adminAuth();
  return POST(req("POST", "/api/admin/spin/links", { body, ...auth }));
}

beforeAll(async () => {
  await truncateAll();
});

describe("batch size", () => {
  beforeEach(async () => {
    await prisma.spinLink.deleteMany({});
  });

  test("defaults to a single link when count is omitted", async () => {
    const prize = await makeSpinPrize({ label: "Single", cashEtb: 100 });
    const { status, body } = await json<{ codes: string[]; count: number }>(
      await generate({ prizeId: prize.id }),
    );

    expect(status).toBe(200);
    expect(body.count).toBe(1);
    expect(body.codes).toHaveLength(1);
    expect(await prisma.spinLink.count()).toBe(1);
  });

  test("creates exactly `count` links, each with a distinct code", async () => {
    const prize = await makeSpinPrize({ label: "Batch", cashEtb: 500 });
    const { body } = await json<{ codes: string[] }>(
      await generate({ prizeId: prize.id, count: 25, note: "influencers" }),
    );

    expect(body.codes).toHaveLength(25);
    // A repeated code would mean two people racing for one prize.
    expect(new Set(body.codes).size).toBe(25);

    const rows = await prisma.spinLink.findMany();
    expect(rows).toHaveLength(25);
    expect(new Set(rows.map((r) => r.code)).size).toBe(25);
    // Every row is independently claimable and carries the shared note.
    expect(rows.every((r) => r.claimedByUserId === null && r.fulfilledRef === null)).toBe(true);
    expect(rows.every((r) => r.note === "influencers")).toBe(true);
    expect(rows.every((r) => r.prizeId === prize.id)).toBe(true);
  });

  test("refuses a batch over the cap, and creates nothing", async () => {
    const prize = await makeSpinPrize({ cashEtb: 100_000 });
    const { status } = await json(await generate({ prizeId: prize.id, count: 101 }));

    expect(status).toBe(400);
    // 101 × 100,000 ETB would be ten million in guaranteed payouts.
    expect(await prisma.spinLink.count()).toBe(0);
  });

  test.each([0, -5, 1.5])("rejects a count of %s without creating anything", async (count) => {
    const prize = await makeSpinPrize();
    const { status } = await json(await generate({ prizeId: prize.id, count }));

    expect(status).toBe(400);
    expect(await prisma.spinLink.count()).toBe(0);
  });
});

describe("prize validation still applies to a batch", () => {
  beforeEach(async () => {
    await prisma.spinLink.deleteMany({});
  });

  test("an unknown prize is rejected", async () => {
    const { status } = await json(await generate({ prizeId: "nope", count: 10 }));
    expect(status).toBe(404);
    expect(await prisma.spinLink.count()).toBe(0);
  });

  test("a try-again wedge cannot be guaranteed, however many are asked for", async () => {
    const none = await makeSpinPrize({ label: "Try again", kind: "NONE", cashEtb: 0 });
    const { status } = await json(await generate({ prizeId: none.id, count: 10 }));

    expect(status).toBe(400);
    expect(await prisma.spinLink.count()).toBe(0);
  });
});

describe("the label snapshot", () => {
  test("is captured on every row, so a renamed prize doesn't rewrite history", async () => {
    await prisma.spinLink.deleteMany({});
    const prize = await makeSpinPrize({ label: "Original Name", cashEtb: 250 });
    await generate({ prizeId: prize.id, count: 3 });

    await prisma.spinPrize.update({ where: { id: prize.id }, data: { label: "Renamed" } });

    const rows = await prisma.spinLink.findMany();
    expect(rows.every((r) => r.prizeLabel === "Original Name")).toBe(true);
  });
});
