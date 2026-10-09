import { beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { DELETE, GET, PATCH, POST, PUT } from "@/app/api/admin/home-promos/route";
import { GET as image } from "@/app/api/home-promos/[id]/image/route";
import { getHomePromoSlots } from "@/lib/homePromos";
import { truncateAll } from "../factories";
import { adminAuth, adminSecretOnly } from "../helpers/auth";
import { json, params, req } from "../helpers/req";

// connection() only means something inside a request; here it's a no-op.
vi.mock("next/server", async (orig) => ({ ...(await orig<typeof import("next/server")>()), connection: async () => {} }));

/*
 * Admin → Homepage Promos, end to end: the admin API (auth, validation,
 * create/edit/toggle/reorder/delete, uploads) and what the lobby then shows.
 */

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);

async function multipart(method: "POST" | "PUT", fields: Record<string, string | string[]>, files: Record<string, File> = {}) {
  const auth = await adminAuth();
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) for (const x of [v].flat()) fd.append(k, x);
  for (const [k, v] of Object.entries(files)) fd.set(k, v);
  const headers = new Headers(auth.headers);
  headers.set("cookie", Object.entries(auth.cookies).map(([k, v]) => `${k}=${v}`).join("; "));
  const r = new NextRequest("http://localhost:3000/api/admin/home-promos", { method, headers, body: fd });
  return json<{ id?: string; error?: string; hiddenReason?: string | null }>(await (method === "POST" ? POST(r) : PUT(r)));
}
const png = (name = "a.png") => new File([PNG], name, { type: "image/png" });

const text: Record<string, string | string[]> = { pages: "casino", title: "Deposit offer", heading: "Top up with telebirr", description: "Instant ETB deposits", destType: "internal", destUrl: "/deposit", layout: "banner", slot: "middle", isActive: "true" };

async function list() {
  const r = await json<{ promos: { id: string; isActive: boolean; slot: string; pages: string[]; sortOrder: number; hiddenReason: string | null; hasImage: boolean }[] }>(
    await GET(req("GET", "/api/admin/home-promos", await adminAuth())),
  );
  expect(r.status).toBe(200);
  return r.body.promos;
}

describe("home promos", () => {
  beforeAll(truncateAll);
  beforeEach(async () => { await prisma.homePromo.deleteMany(); });

  test("admin auth is required", async () => {
    expect((await GET(req("GET", "/api/admin/home-promos"))).status).toBe(404);
    expect((await GET(req("GET", "/api/admin/home-promos", adminSecretOnly()))).status).toBe(401);
    expect((await PATCH(req("PATCH", "/api/admin/home-promos", { ...adminSecretOnly(), body: { id: "x", isActive: true } }))).status).toBe(401);
    expect((await DELETE(req("DELETE", "/api/admin/home-promos?id=x", adminSecretOnly()))).status).toBe(401);
  });

  test("validates fields and links", async () => {
    expect((await multipart("POST", { ...text, title: "" })).body.error).toMatch(/title/i);
    expect((await multipart("POST", { ...text, destUrl: "//evil.com" })).status).toBe(400);
    expect((await multipart("POST", { ...text, destType: "external", destUrl: "http://x.com" })).status).toBe(400);
    expect((await multipart("POST", { ...text, slot: "top" })).status).toBe(400);
    expect((await multipart("POST", { ...text, startsAt: "2026-10-10T00:00:00Z", endsAt: "2026-10-09T00:00:00Z" })).status).toBe(400);
    const svg = new File(["<svg/>"], "x.svg", { type: "image/svg+xml" });
    expect((await multipart("POST", text, { image: svg })).status).toBe(400);
    expect(await prisma.homePromo.count()).toBe(0); // nothing half-created
  });

  test("create text promo → live in its slot; toggle off → gone", async () => {
    const c = await multipart("POST", text);
    expect(c.status).toBe(200);
    expect(c.body.hiddenReason).toBeNull();
    let slots = await getHomePromoSlots();
    expect(slots.middle).toHaveLength(1);
    expect(slots.after_first).toBeUndefined();
    const row = slots.middle![0];
    expect(row.kind === "banner" && row.promo.href).toBe("/deposit");

    const t = await PATCH(req("PATCH", "/api/admin/home-promos", { ...(await adminAuth()), body: { id: c.body.id, isActive: false } }));
    expect(t.status).toBe(200);
    slots = await getHomePromoSlots();
    expect(slots.middle).toBeUndefined();
    expect((await list())[0].hiddenReason).toBe("Switched off");
    expect(await prisma.adminLog.count({ where: { action: { in: ["CREATE_HOME_PROMO", "DISABLE_HOME_PROMO"] } } })).toBe(2);
  });

  test("pages: a promotion shows only on the lobbies it's set for", async () => {
    expect((await multipart("POST", { ...text, pages: [] })).body.error).toMatch(/page/i);
    expect((await multipart("POST", { ...text, pages: ["home"] })).status).toBe(400);
    const c = await multipart("POST", { ...text, pages: ["live", "games"] });
    expect(c.status).toBe(200);
    expect((await getHomePromoSlots("casino")).middle).toBeUndefined();
    expect((await getHomePromoSlots("live")).middle).toHaveLength(1);
    expect((await getHomePromoSlots("games")).middle).toHaveLength(1);
    expect((await list())[0]).toMatchObject({ pages: ["live", "games"] });
  });

  test("new promotions start switched off", async () => {
    const { isActive: _, ...rest } = text;
    const c = await multipart("POST", rest);
    expect(c.body.hiddenReason).toBe("Switched off");
  });

  test("incomplete, expired and future promotions are hidden", async () => {
    await multipart("POST", { ...text, title: "no heading", heading: "" });
    await multipart("POST", { ...text, title: "no link", destUrl: "" });
    await multipart("POST", { ...text, title: "ended", endsAt: new Date(Date.now() - 60_000).toISOString() });
    await multipart("POST", { ...text, title: "later", startsAt: new Date(Date.now() + 86_400_000).toISOString() });
    await multipart("POST", { ...text, title: "image, no alt", heading: "" }, { image: png() });
    const reasons = (await list()).map((p) => p.hiddenReason).sort();
    expect(reasons).toEqual(["Ended", "Image needs alternative text", "Needs a valid destination", "Needs an image or a heading", "Not started yet"]);
    expect(await getHomePromoSlots()).toEqual({});
  });

  test("images: upload, serve, replace, remove, delete", async () => {
    const c = await multipart("POST", { ...text, heading: "", imageAlt: "Deposit offer", layout: "poster" }, { image: png(), mobileImage: png("m.png") });
    expect(c.status, JSON.stringify(c.body)).toBe(200);
    expect(c.body.hiddenReason).toBeNull();
    const id = c.body.id!;
    const first = await prisma.homePromo.findUniqueOrThrow({ where: { id } });
    expect(first.imageKey).toMatch(new RegExp(`^home-promos/${id}/image-`));

    const served = await image(req("GET", `/api/home-promos/${id}/image?variant=mobile`), params({ id }));
    expect(served.status).toBe(200);
    expect(served.headers.get("content-type")).toBe("image/png");
    expect(new Uint8Array(await served.arrayBuffer())).toEqual(PNG);

    const slots = await getHomePromoSlots();
    const row = slots.middle![0];
    expect(row.kind).toBe("posters");
    if (row.kind === "posters") {
      expect(row.promos[0].imageUrl).toContain(`/api/home-promos/${id}/image?variant=desktop`);
      expect(row.promos[0].mobileImageUrl).toContain("variant=mobile");
    }

    // remove the mobile image; desktop stays
    const e = await multipart("PUT", { ...text, id, heading: "", imageAlt: "Deposit offer", layout: "poster", removeMobileImage: "true" });
    expect(e.status).toBe(200);
    const after = await prisma.homePromo.findUniqueOrThrow({ where: { id } });
    expect(after.mobileImageKey).toBeNull();
    expect(after.imageKey).toBe(first.imageKey);
    expect((await image(req("GET", `/api/home-promos/${id}/image?variant=mobile`), params({ id }))).status).toBe(404);

    const d = await DELETE(req("DELETE", `/api/admin/home-promos?id=${id}`, await adminAuth()));
    expect(d.status).toBe(200);
    expect(await prisma.homePromo.count()).toBe(0);
    expect((await DELETE(req("DELETE", `/api/admin/home-promos?id=${id}`, await adminAuth()))).status).toBe(404);
  });

  test("edit updates fields; unknown id 404s", async () => {
    const c = await multipart("POST", text);
    const e = await multipart("PUT", { ...text, id: c.body.id!, heading: "Sports this weekend", destUrl: "/sports", slot: "lower" });
    expect(e.status).toBe(200);
    const slots = await getHomePromoSlots();
    expect(slots.middle).toBeUndefined();
    const row = slots.lower![0];
    expect(row.kind === "banner" && [row.promo.heading, row.promo.href]).toEqual(["Sports this weekend", "/sports"]);
    expect((await multipart("PUT", { ...text, id: "missing" })).status).toBe(404);
  });

  test("posters pair in display order; reorder changes it", async () => {
    const ids: string[] = [];
    for (const t of ["A", "B", "C"]) {
      ids.push((await multipart("POST", { ...text, title: t, heading: t, layout: "poster" })).body.id!);
    }
    const order = (slots: Awaited<ReturnType<typeof getHomePromoSlots>>) =>
      slots.middle!.map((r) => (r.kind === "posters" ? r.promos.map((p) => p.heading).join("") : "B"));
    expect(order(await getHomePromoSlots())).toEqual(["AB", "C"]); // odd one out gets its own row

    const r = await PATCH(req("PATCH", "/api/admin/home-promos", {
      ...(await adminAuth()),
      body: { order: [{ id: ids[2], slot: "middle", sortOrder: 0 }, { id: ids[0], slot: "middle", sortOrder: 1 }, { id: ids[1], slot: "middle", sortOrder: 2 }] },
    }));
    expect(r.status).toBe(200);
    expect(order(await getHomePromoSlots())).toEqual(["CA", "B"]);

    const badOrder = await PATCH(req("PATCH", "/api/admin/home-promos", { ...(await adminAuth()), body: { order: [{ id: ids[0], slot: "top", sortOrder: 0 }] } }));
    expect(badOrder.status).toBe(400);
  });
});
