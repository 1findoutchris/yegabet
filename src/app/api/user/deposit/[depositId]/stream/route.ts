import { NextRequest } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { redis } from "@/lib/redis";

const TIMEOUT_MS   = 15 * 60 * 1_000; // 15 min
const HEARTBEAT_MS = 25_000;           // keep proxies alive

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ depositId: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) return new Response("Unauthorized", { status: 401 });

  const { depositId } = await params;

  const deposit = await prisma.depositRequest.findFirst({
    where: { id: depositId, userId: session.user.id },
    select: { status: true, amount: true },
  });
  if (!deposit) return new Response("Not found", { status: 404 });

  const encoder = new TextEncoder();
  const sse = (data: object) => encoder.encode(`data: ${JSON.stringify(data)}\n\n`);
  const comment = encoder.encode(": ping\n\n");

  // Already approved — respond immediately without opening a persistent connection
  if (deposit.status === "APPROVED") {
    return new Response(sse({ type: "approved", amount: Number(deposit.amount) }), {
      headers: sseHeaders(),
    });
  }

  const stream = new ReadableStream({
    async start(controller) {
      let closed = false;

      function close() {
        if (closed) return;
        closed = true;
        clearInterval(heartbeat);
        clearTimeout(timer);
        sub.unsubscribe().catch(() => {});
        sub.quit().catch(() => {});
        try { controller.close(); } catch { /* already closed */ }
      }

      // Each subscriber needs its own Redis connection
      const sub = redis.duplicate();
      sub.on("error", close);

      sub.on("message", (_ch: string, msg: string) => {
        if (!closed) controller.enqueue(sse(JSON.parse(msg)));
        close();
      });

      try {
        await sub.subscribe(`deposit:${depositId}`);
      } catch {
        controller.enqueue(sse({ type: "error" }));
        close();
        return;
      }

      const heartbeat = setInterval(() => {
        if (closed) return;
        try { controller.enqueue(comment); } catch { close(); }
      }, HEARTBEAT_MS);

      const timer = setTimeout(() => {
        if (!closed) controller.enqueue(sse({ type: "timeout" }));
        close();
      }, TIMEOUT_MS);

      req.signal.addEventListener("abort", close);
    },
  });

  return new Response(stream, { headers: sseHeaders() });
}

function sseHeaders(): HeadersInit {
  return {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    "Connection": "keep-alive",
    "X-Accel-Buffering": "no",
  };
}
