import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireInPersonAgent, isAgentAuthError } from "@/lib/agentAuth";
import { putObject } from "@/lib/storage";

/**
 * POST — mark a WON ticket paid. The agent hands the customer cash and
 * attaches the receipt/transfer screenshot as proof (multipart "file" field).
 * WON → PAID is the only allowed transition; the ticket code dies here.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireInPersonAgent();
  if (isAgentAuthError(auth)) return auth;

  const { id } = await params;
  const ticket = await prisma.ticket.findFirst({
    where: { id, agentId: auth.userId },
    select: { id: true, status: true, publicId: true },
  });
  if (!ticket) return NextResponse.json({ error: "Ticket not found" }, { status: 404 });
  if (ticket.status === "PAID") return NextResponse.json({ error: "Already paid" }, { status: 409 });
  if (ticket.status !== "WON") {
    return NextResponse.json({ error: "Only a winning ticket can be paid" }, { status: 409 });
  }

  // Receipt is required — it's the only artefact proving the cash handover.
  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return NextResponse.json({ error: "Attach the payment receipt" }, { status: 400 });
  }
  const ext = file.type === "image/png" ? "png" : file.type === "image/webp" ? "webp" : "jpg";
  const proofKey = `ticket-proofs/${ticket.publicId}-${Date.now()}.${ext}`;
  await putObject(proofKey, Buffer.from(await file.arrayBuffer()), file.type);

  const updated = await prisma.ticket.update({
    where: { id: ticket.id },
    data: { status: "PAID", paidAt: new Date(), proofKey },
  });

  return NextResponse.json({ ticket: updated });
}
